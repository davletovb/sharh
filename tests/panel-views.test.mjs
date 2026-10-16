import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {ReadingPreferences,TIERS,outputTier,targetFor,validateTarget,providerBadges,usable} from '../src/ui/preferences.mjs';
import {graphRecords,layoutGraph} from '../src/ui/graph-layout.mjs';
import {createWorkspace} from '../extension/ui/workspace.mjs';
import {createAnalysisView} from '../extension/ui/views.mjs';
import {createModelPicker} from '../extension/ui/model-picker.mjs';
import {installSelectionToolbar} from '../extension/ui/passage-toolbar.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {exampleDocument} from './helpers/document.mjs';
import {versionOf} from '../src/documents/model.mjs';
const memory=()=>{let data={};return {async get(k){return {[k]:structuredClone(data[k])};},async set(v){data={...data,...structuredClone(v)};}};};
const changes={addListener(){},removeListener(){}};
const info={path:'seatline',provider:'codex',label:'Codex',available:true,signedIn:true,accepted:true,signIn:'subscription',models:[],capabilities:{toolIsolation:true,streaming:true,sessions:true,effort:['none','low','high'],serviceTier:['standard','fast']}};
function dom(){const d=new JSDOM('<!doctype html><html lang="en"><title>Workspace</title><body><main id="host"></main></body></html>',{url:'https://example.org',pretendToBeVisual:true});for(const k of ['document','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','location'])globalThis[k]=typeof d.window[k]==='function'?d.window[k].bind(d.window):d.window[k];return d;}
const jsonl=(...r)=>r.map(v=>JSON.stringify(v)).join('\n')+'\n',end={t:'end'};
const node=(id,text='A finding')=>({t:'node',id,kind:'claim',text,refs:[3],basis:'inferred'});

test('four tier defaults remain independent, merge appearance updates and map book output caps',async()=> {
 const storage=memory(),prefs=new ReadingPreferences(storage);await prefs.load();assert.equal(Object.keys(TIERS).length,4);assert.equal(prefs.value.tiers.quick.model,'haiku');
 await prefs.save({tiers:{quick:{path:'seatline',provider:'codex',model:'custom',effort:'none'}}});await prefs.save({theme:'ink',language:'uz-Cyrl'});
 const next=await new ReadingPreferences(storage).load();assert.equal(next.tiers.quick.provider,'codex');assert.equal(next.tiers.analysis.model,'opus');assert.equal(next.language,'uz-Cyrl');assert.equal(outputTier('book'),'analysis');
});
test('model choices enforce advertised effort/speed and preserve provider default/manual model IDs',()=> {
 assert.equal(validateTarget({path:'seatline',provider:'codex',model:'vendor/model:1',effort:'none',serviceTier:'fast'},info).model,'vendor/model:1');
 assert.throws(()=>validateTarget({path:'seatline',provider:'codex',model:'x; rm',effort:'none'},info),/model ID/);
 assert.throws(()=>validateTarget({path:'seatline',provider:'codex',effort:'max'},info),/effort/);
 assert.throws(()=>validateTarget({path:'seatline',provider:'codex',serviceTier:'slow'},info),/speed/);
 assert.deepEqual(targetFor({...info,capabilities:{}},{effort:'high',serviceTier:'fast'}),{path:'seatline',provider:'codex',model:null});assert.ok(usable(info));assert.ok(!usable({...info,accepted:false}));assert.ok(providerBadges({...info,capabilities:{}}).includes('No sessions'));
});
test('graph layouts link valid records, preserve labels, collapse descendants and stay finite for all three maps',()=> {
 const entries=[{record:{t:'sec',id:'a',title:'Root',role:'claim',span:[1,5]}},{record:{t:'sec',id:'b',parent:'a',title:'Child',role:'evidence',span:[2,4]}}];
 const graph=graphRecords(entries,'structure');assert.equal(graph.links.length,1);assert.equal(graphRecords(entries,'structure',['a']).nodes.length,1);
 for(const lens of ['structure','logic','thinking']){const data=lens==='structure'?graph:graphRecords([{record:node('a')},{record:node('b')},{record:{t:'edge',from:'a',to:'b',rel:'supports'}}],lens);const result=layoutGraph(data,lens);assert.equal(result.nodes.length,2);assert.ok(result.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));assert.ok(result.width>0 && result.height>0);}
});
test('picker renders path/provider groups, capability-only options, manual IDs and saved per-tier overrides',async()=> {
 const d=dom(),host=document.getElementById('host'),storage=memory(),client={async call(method){return method==='discover'?[info,{...info,provider:'grok',label:'Grok',capabilities:{toolIsolation:true},models:[{id:'grok',label:'Grok'}]}]:null;}};
 try{const picker=await createModelPicker(host,{client,storage});await picker.ready;assert.equal(host.querySelectorAll('optgroup').length,2);assert.match(host.querySelector('optgroup').label,/Seatline/);assert.ok(host.querySelector('input').closest('label').hidden===false);
 const selects=host.querySelectorAll('select');selects[2].value='none';selects[3].value='fast';host.querySelector('input').value='my/model';assert.equal(picker.target.serviceTier,'fast');
 host.querySelectorAll('button')[0].click();await new Promise(r=>setTimeout(r,10));assert.equal((await storage.get('sharhReading')).sharhReading.tiers.analysis.model,'my/model');
 selects[1].value='2';selects[1].dispatchEvent(new d.window.Event('change'));assert.equal(selects[2].closest('label').hidden,true);assert.equal(selects[3].closest('label').hidden,true);assert.equal(host.querySelector('input').closest('label').hidden,true);assert.equal(picker.target.model,'grok');
 }finally{d.window.close();}
});
test('streaming views keep model markup inert, expose references and inspection, and cancel pending rendering on disposal',async()=> {
 const d=dom(),doc=await exampleDocument(),refs=[],inspected=[];
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'logic',onReference:n=>refs.push(n),onInspect:e=>inspected.push(e),workerFactory:()=>{throw Error('worker unavailable');}});
 view.record({sequence:1,record:node('a','<img src=x onerror=alert(1)>'),flags:[]});await view.settled();assert.equal(document.querySelector('img'),null);assert.match(document.body.textContent,/<img/);document.querySelector('.inspect-finding').click();await Promise.resolve();assert.deepEqual(refs,[]);document.querySelector('.reference').click();await Promise.resolve();assert.deepEqual(refs,[3]);assert.equal(inspected.length,1);assert.match(document.body.textContent,/inferred/);
 view.record({sequence:2,record:node('b'),flags:[]});view.dispose();await new Promise(r=>setTimeout(r,25));assert.equal(document.querySelector('.analysis-view'),null);
 }finally{d.window.close();}
});
test('workspace runs, saves, continues, restores and compares actual engine versions without another generation',async()=> {
 const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
 const path=new FakePath({scripts:[{text:jsonl(node('a')),truncated:true},{text:jsonl(node('b'),end)}],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}}),client={call:async method=>method==='discover'?path.discover():null};let workspace;
 try{workspace=await createWorkspace(document.getElementById('host'),{store,engine,client,storage,changes});await workspace.ready;await workspace.setDocument(doc);
 const lens=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Lens')).querySelector('select');lens.value='logic';const first=await workspace.run();assert.equal(first.run.status,'truncated');assert.equal(path.calls.length,1);
 const continuation=[...document.querySelectorAll('button')].find(b=>b.textContent==='Continue');continuation.click();for(let i=0;i<100 && path.calls.length<2;i++)await new Promise(r=>setTimeout(r,5));for(let i=0;i<100 && workspace.active;i++)await new Promise(r=>setTimeout(r,5));assert.equal(path.calls.length,2);
 workspace.dispose();workspace=await createWorkspace(document.getElementById('host'),{store,engine,client,storage,changes});await workspace.ready;await workspace.setDocument(doc);await workspace.view.settled();assert.equal(path.calls.length,2);assert.equal(workspace.view.metrics.records,2);
 const selectors=document.querySelectorAll('.run-history select');selectors[1].value=first.run.id;[...document.querySelectorAll('button')].find(b=>b.textContent==='Compare versions').click();for(let i=0;i<100 && document.querySelectorAll('.compare-columns>section').length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(document.querySelectorAll('.compare-columns>section').length,2);assert.equal(path.calls.length,2);
 }finally{workspace?.dispose();store.close();d.window.close();}
});
test('passage actions send selected spans with neighbouring context in the requested language using the Quick tier',async()=> {
 const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);await storage.set({sharhReading:{language:'uz',tiers:{}}});
 const path=new FakePath({scripts:Array.from({length:4},()=>({text:jsonl({t:'note',text:'Explanation',refs:[5]},end)})),wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}}),client={call:async method=>method==='discover'?path.discover():null};let workspace;
 try{workspace=await createWorkspace(document.getElementById('host'),{store,engine,client,storage,changes});await workspace.ready;await workspace.setDocument(doc);
 for(const action of ['Explain','Translate','Logic','Define'])await workspace.passage(action,{spans:[{n:5,start:0,end:8}]});
 for(const [i,call] of path.calls.entries()){const data=JSON.parse(call.request.document),task=JSON.parse(call.request.task.split('\n')[1]);assert.deepEqual(data.blocks.map(b=>b.n),[2,3,4,5,6]);assert.equal(call.request.tier,'quick');assert.equal(task.outputLanguage,'uz');assert.equal(task.action,['Explain','Translate','Logic','Define'][i]);assert.ok(task.instructions.length>200);assert.ok(data.blocks.find(b=>b.n===5).selected);}
 }finally{workspace?.dispose();store.close();d.window.close();}
});

test('selection toolbar preserves the selected passage, supports keyboard arrows/Escape and obeys disabled access',async()=> {
 const d=dom(),p=document.createElement('p');p.textContent='Selected words';document.getElementById('host').append(p);const range=document.createRange();range.selectNodeContents(p);range.getBoundingClientRect=()=>({left:20,bottom:60});getSelection().addRange(range);let allowed=false;const calls=[];
 const spans={spans:[{n:3,start:0,end:8}]},toolbar=installSelectionToolbar({document,enabled:async()=>allowed,selection:async()=>spans,onPrepare:()=>{throw Error('WARMUP_UNAVAILABLE');},onAction:(action,selection)=>calls.push({action,selection})});
 try{document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,5));assert.equal(document.querySelector('[role=toolbar]'),null);allowed=true;document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,5));
 const bar=document.querySelector('[role=toolbar]'),buttons=bar.querySelectorAll('button');assert.equal(bar.hidden,false);buttons[0].focus();buttons[0].dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(document.activeElement,buttons[1]);buttons[1].click();await new Promise(r=>setTimeout(r,0));assert.equal(calls[0].action,'Translate');assert.deepEqual(calls[0].selection,spans);assert.equal(bar.hidden,true);
 }finally{toolbar.dispose();d.window.close();}
});

test('passage worker serializes pending intentions, validates sender/navigation/permission and never overwrites an unconsumed action',async()=> {
 const {installPassages,passageKey}=await import('../extension/lib/passages.mjs');globalThis.indexedDB=new IDBFactory();const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}}),storage=memory();let allowed=true,currentURL='https://example.org/article',opens=0;
 const chrome={runtime:{id:'extension-id',onMessage:event()},tabs:{onUpdated:event(),async get(){return {id:7,url:currentURL};},async query(){return [];},async sendMessage(){}},permissions:{onAdded:event(),onRemoved:event(),async contains(){return allowed;}},scripting:{async executeScript(){}},sidePanel:{async open(){opens++;}},storage:{session:{...storage}},extension:{}};
 installPassages(chrome);const listener=chrome.runtime.onMessage.listeners[0],doc=await exampleDocument(currentURL),sender={id:'extension-id',url:currentURL,tab:{id:7,windowId:2},frameId:0};
 const message={type:'sharh:passage:invoke',action:'Explain',extraction:doc,selection:{spans:[{n:3,start:0,end:8}]}},send=(m=message,s=sender)=>new Promise(resolve=>listener(m,s,resolve));
 const documentStore=await openDocumentStore();await documentStore.saveDocument(doc);await documentStore.put('runs',{id:'article-run',docId:doc.id,extractionVersion:doc.version,stale:false});message.extraction={...doc,version:await versionOf(currentURL,'sidebar')};
 const replies=await Promise.all([send(),send({...message,action:'Translate'})]);assert.equal(replies.filter(r=>r.result===true).length,1);assert.equal(replies.filter(r=>r.error?.includes('waiting')).length,1);assert.equal(opens,2);const saved=(await storage.get(passageKey(2)))[passageKey(2)];assert.equal(saved.action,'Explain');assert.equal(saved.sourceTab,7);
 assert.equal((await documentStore.getDocument(doc.id)).version,doc.version);assert.equal((await documentStore.all('runs'))[0].stale,false);assert.equal(saved.version,message.extraction.version);documentStore.close();
 allowed=false;assert.match((await send()).error,/Enable passage actions/);assert.equal((await storage.get(passageKey(2)))[passageKey(2)].id,saved.id);
 allowed=true;currentURL='https://example.org/another';assert.match((await send()).error,/source page changed/);let replied=false;assert.equal(listener(message,{...sender,id:'another-extension'},()=>{replied=true;}),undefined);assert.equal(replied,false);
});

test('passage extraction covers article-excluded sidebars and cross-region selections while preserving fallback anchors',async()=> {
 const {extractSelectedHTML,extractHTML,resolveHTMLAnchor}=await import('../src/readers/html.mjs'),d=dom();document.title='A long article';document.body.innerHTML='<article><h1>A long article</h1><p>'+('A public argument and its evidence. '.repeat(30))+'</p><p id="tail">The article ends here.</p></article><aside><p id="outside">An appendix beside the main article.</p></aside>';
 const choose=(first,last=first)=>{const r=document.createRange();r.setStart(first.firstChild,0);r.setEnd(last.firstChild,last.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);};
 try{choose(document.querySelector('article p'));const main=await extractSelectedHTML(document);assert.equal(main.extraction.mode,'article');assert.equal(main.extraction.includeNavigation,undefined);
 choose(document.getElementById('outside'));const side=await extractSelectedHTML(document);assert.equal(side.extraction.includeNavigation,true);const block=side.extraction.blocks.find(b=>b.text==='An appendix beside the main article.');assert.ok(side.selection.spans.some(s=>s.n===block.n));assert.equal(resolveHTMLAnchor(document,block.anchor).text,block.text);
 const unrelated=document.createElement('p');unrelated.textContent='Unrelated insertion';document.body.prepend(unrelated);assert.equal(resolveHTMLAnchor(document,block.anchor).text,block.text);
 choose(document.getElementById('tail'),document.getElementById('outside'));const mixed=await extractSelectedHTML(document);assert.equal(mixed.extraction.includeNavigation,true);assert.equal(mixed.selection.spans.length,2);
 const standard=await extractHTML(document,{mode:'whole'});assert.ok(!standard.blocks.some(b=>b.text===block.text));
 }finally{d.window.close();}
});

test('passage intentions survive setup failure and acknowledge only a durably accepted run before provider launch',async()=> {
 const {acceptPassage}=await import('../extension/ui/passage-handoff.mjs'),d=dom(),storage=memory(),session=memory();session.remove=async key=>session.set({[key]:undefined});
 const store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);const key='pending',intent={id:'intent-one',docId:doc.id,version:doc.version,action:'Explain',selection:{spans:[{n:5,start:0,end:8}]}};await session.set({[key]:intent});
 const path=new FakePath({scripts:[{text:jsonl({t:'note',text:'Accepted passage',refs:[5]},end)}],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}});let workspace;
 try{await assert.rejects(acceptPassage({key,storage:session,store,engine,show:async()=>{throw Error('TRANSIENT_SETUP');}}),/TRANSIENT_SETUP/);assert.deepEqual((await session.get(key))[key],intent);assert.equal(path.calls.length,0);
 workspace=await createWorkspace(document.getElementById('host'),{store,engine,client:{call:async m=>m==='discover'?path.discover():null},storage,changes});await workspace.ready;
 await assert.rejects(acceptPassage({key,storage:session,store,engine,show:()=>workspace.setDocument(doc),onPassage:async()=>{throw Error('DISCOVERY_FAILED');}}),/DISCOVERY_FAILED/);assert.deepEqual((await session.get(key))[key],intent);
 const run=path.run.bind(path);path.run=async(...args)=>{assert.equal((await session.get(key))[key],undefined);assert.ok((await engine.repository.list(doc.id)).some(r=>r.passageIntentId===intent.id));return run(...args);};
 const result=await acceptPassage({key,storage:session,store,engine,show:()=>workspace.setDocument(doc),onPassage:(...args)=>workspace.passage(...args)});assert.equal(result.run.status,'completed');assert.equal(path.calls.length,1);assert.equal((await session.get(key))[key],undefined);
 }finally{workspace?.dispose();store.close();d.window.close();}
});

test('failed passage acknowledgement sends nothing and panel recovery opens its accepted run without replay',async()=> {
 const {acceptPassage}=await import('../extension/ui/passage-handoff.mjs'),d=dom(),storage=memory(),session=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
 const key='pending',intent={id:'intent-two',docId:doc.id,version:doc.version,action:'Define',selection:{spans:[{n:5,start:0,end:8}]}};await session.set({[key]:intent});session.remove=async()=>{throw Error('ACK_STORAGE_FAILED');};
 const path=new FakePath({scripts:[],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}});let workspace;
 try{workspace=await createWorkspace(document.getElementById('host'),{store,engine,client:{call:async m=>m==='discover'?path.discover():null},storage,changes});await workspace.ready;
 await assert.rejects(acceptPassage({key,storage:session,store,engine,show:()=>workspace.setDocument(doc),onPassage:(...args)=>workspace.passage(...args)}),/ACK_STORAGE_FAILED/);assert.equal(path.calls.length,0);assert.deepEqual((await session.get(key))[key],intent);const accepted=(await engine.repository.list(doc.id))[0];assert.equal(accepted.status,'interrupted');assert.equal(accepted.passageIntentId,intent.id);
 session.remove=async key=>session.set({[key]:undefined});let opened;const next=await acceptPassage({key,storage:session,store,engine,show:()=>workspace.setDocument(doc),onPassage:()=>{throw Error('MUST_NOT_REPLAY');},onSaved:async id=>{opened=id;await workspace.openSaved(id);}});assert.equal(opened,accepted.id);assert.equal(next.restored,true);assert.equal(path.calls.length,0);assert.equal((await session.get(key))[key],undefined);
 }finally{workspace?.dispose();store.close();d.window.close();}
});
test('paragraph marks inside finding text open their paragraph, and the gist view shows only the point and the abstract',async()=> {
 const d=dom(),doc=await exampleDocument(),refs=[];
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'summary',gist:true,onReference:(n,original)=>refs.push([n,original]),workerFactory:()=>{throw Error('worker unavailable');}});
 view.record({sequence:1,record:{t:'sum',level:'line',text:'It argues for care (¶3) and against haste (¶4–5, [¶99]).',refs:[3]},flags:[]});
 view.record({sequence:2,record:{t:'sum',level:'abstract',text:'Short and plain.',refs:[3]},flags:[]});
 view.record({sequence:3,record:{t:'sum',level:'section',text:'Hidden section.',refs:[3]},flags:[]});
 view.record({sequence:4,record:{t:'arc',n:1,stage:'opening',text:'Hidden arc.',refs:[3]},flags:[]});
 await view.settled();
 assert.deepEqual([...document.querySelectorAll('.finding')].map(c=>c.dataset.level),['line','abstract']);assert.doesNotMatch(document.body.textContent,/Hidden/);
 const links=[...document.querySelectorAll('.reading-text .inline-ref')];assert.deepEqual(links.map(l=>l.textContent),['¶3','¶4–5']);assert.equal(document.querySelector('.reading-text').textContent,'It argues for care (¶3) and against haste (¶4–5, [¶99]).');
 links[1].click();await Promise.resolve();assert.deepEqual(refs,[[4,null]]);
 view.dispose();
 }finally{d.window.close();}
});
test('critique keeps strengths, limitations and the quality of the evidence in their own groups',async()=> {
 const d=dom(),doc=await exampleDocument();
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'critique',workerFactory:()=>{throw Error('worker unavailable');}});
 ['strength','weakness','evidence_quality','counterargument'].forEach((kind,i)=>view.record({sequence:i+1,record:{t:'facet',kind,text:`A ${kind}.`,refs:[3],basis:'inferred'},flags:[]}));
 await view.settled();
 const groups=[...document.querySelectorAll('.record-group')].map(g=>[g.querySelector('h4').textContent,[...g.querySelectorAll('.finding')].length]);
 assert.deepEqual(groups,[['Strengths',1],['Limitations and counterarguments',2],['Quality of the evidence',1]]);
 view.dispose();
 }finally{d.window.close();}
});
test('an argument check reads in a fixed order, folds assumptions, and conversation cards use plain facet names',async()=> {
 const d=dom(),doc=await exampleDocument(),refs=[];
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'check',compact:true,onReference:n=>refs.push(n),workerFactory:()=>{throw Error('worker unavailable');}});
 // Parts arrive out of order. The reader still gets the claim first and the assessment last.
 [['assessment','Established so far.'],['objection','Repetition is not evidence.'],['reason','First ground.'],['claim','The claim (¶3).'],['reason','Second ground.'],['assumption','That repeating adds support.'],['weakness','The second ground is unexplained.'],['strength','The grounds are plain.']].forEach(([part,text],i)=>view.record({sequence:i+1,record:{t:'chk',part,text,refs:[3],basis:i%2?'stated':'inferred'},flags:[]}));
 await view.settled();
 const parts=[...document.querySelectorAll('.check-part')];assert.deepEqual(parts.map(p=>p.dataset.part),['claim','reason','strength','weakness','assessment','detail']);
 assert.equal(parts.at(-1).tagName,'DETAILS');assert.equal(parts.at(-1).open,false);assert.deepEqual([...parts.at(-1).querySelectorAll('.finding h5')].map(h=>h.textContent),['Strongest objection','Assumption']);
 assert.equal(document.querySelectorAll('.check-part[data-part="reason"] .finding').length,2);assert.equal(document.querySelector('.check-part[data-part="claim"] .finding h5'),null,'the main parts carry no card title');
 document.querySelector('.reading-text .inline-ref').click();await Promise.resolve();assert.deepEqual(refs,[3]);
 view.dispose();
 const second=createAnalysisView(document.getElementById('host'),{doc,lens:'critique',compact:true,workerFactory:()=>{throw Error('worker unavailable');}});
 ['strength','weakness','evidence_quality','counterargument','silence'].forEach((kind,i)=>second.record({sequence:i+1,record:{t:'facet',kind,text:`A ${kind}.`,refs:[3],basis:'inferred'},flags:[]}));
 await second.settled();
 assert.deepEqual([...document.querySelectorAll('.finding h5')].map(h=>h.textContent),['Strength','Weakness','A counterargument','What is left unsaid','Quality of the evidence']);
 second.dispose();
 }finally{d.window.close();}
});
test('a flat outline lists sections with one paragraph range each and says when the outline is inferred',async()=> {
 const d=dom(),doc=await exampleDocument(),refs=[];
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'structure',compact:true,flat:true,onReference:(n,original)=>refs.push([n,original]),workerFactory:()=>{throw Error('worker unavailable');}});
 view.record({sequence:1,record:{t:'sec',id:'s1',title:'Opening',role:'context',gist:'It sets the scene.',span:[1,3],refs:[1,2,3]},flags:[]});
 view.record({sequence:2,record:{t:'sec',id:'s2',parent:'s1',title:'The turn',role:'claim',gist:'It makes the claim.',span:[4,4],refs:[4]},flags:[]});
 view.record({sequence:3,record:{t:'note',text:'A note that the list does not show.'},flags:[]});
 await view.settled();
 assert.equal(document.querySelector('.map-shell'),null);assert.equal(document.querySelector('.map-toggle'),null);
 assert.deepEqual([...document.querySelectorAll('.finding.sec h5')].map(h=>h.textContent),['Opening','The turn']);
 assert.deepEqual([...document.querySelectorAll('.finding.sec .reference')].map(b=>b.textContent),['¶1–3','¶4']);
 assert.equal(document.querySelector('.finding.sec button[aria-expanded]'),null,'nothing to collapse');assert.doesNotMatch(document.body.textContent,/Part of|A note that/);
 assert.equal(document.querySelector('.inferred-outline'),null,'the example text has headings');
 document.querySelectorAll('.finding.sec .reference')[0].click();await Promise.resolve();assert.deepEqual(refs,[[1,null]]);
 view.dispose();
 // A text without headings says its outline is reconstructed.
 const plain={...doc,blocks:doc.blocks.map(b=>({...b,kind:'para'}))},second=createAnalysisView(document.getElementById('host'),{doc:plain,lens:'structure',compact:true,flat:true,workerFactory:()=>{throw Error('worker unavailable');}});
 assert.match(document.querySelector('.inferred-outline').textContent,/^Inferred outline: this text has no headings/);second.dispose();
 }finally{d.window.close();}
});
test('on a conversation card a map waits behind Show map, and relations and basis use plain words',async()=> {
 const d=dom(),doc=await exampleDocument();
 try{const view=createAnalysisView(document.getElementById('host'),{doc,lens:'thinking',compact:true,workerFactory:()=>{throw Error('worker unavailable');}});
 view.record({sequence:1,record:{t:'concept',id:'a',term:'Care',gloss:'Taking trouble over something.',refs:[3]},flags:[]});
 view.record({sequence:2,record:{t:'concept',id:'b',term:'Skill',gloss:'Practised ability.',refs:[3]},flags:[]});
 view.record({sequence:3,record:{t:'edge',from:'a',to:'b',rel:'enables'},flags:[]});
 view.record({sequence:4,record:{t:'facet',kind:'worldview',text:'Craft matters.',refs:[3],basis:'stated'},flags:[]});
 await view.settled();
 const shell=document.querySelector('.map-shell'),toggle=document.querySelector('.map-toggle');
 assert.equal(shell.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(toggle.textContent,'Show map');
 toggle.click();await Promise.resolve();assert.equal(shell.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(toggle.textContent,'Hide map');toggle.click();await Promise.resolve();assert.equal(shell.hidden,true);
 assert.equal(document.querySelector('.finding.edge p').textContent,'Care → Skill · enables');
 assert.equal(document.querySelector('.finding.facet .basis').textContent,'Stated in the text');assert.equal(document.querySelector('.finding.facet h5').textContent,'Worldview');
 view.dispose();
 }finally{d.window.close();}
});
