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
 view.record({sequence:1,record:node('a','<img src=x onerror=alert(1)>'),flags:[]});await view.settled();assert.equal(document.querySelector('img'),null);assert.match(document.body.textContent,/<img/);document.querySelector('.reference').click();document.querySelector('.inspect-finding').click();await Promise.resolve();assert.ok(refs.includes(3));assert.equal(inspected.length,1);assert.match(document.body.textContent,/inferred/);
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
 for(const call of path.calls){const data=JSON.parse(call.request.document);assert.deepEqual(data.blocks.map(b=>b.n),[2,3,4,5,6]);assert.equal(call.request.tier,'quick');assert.match(call.request.task,/"outputLanguage":"uz"/);assert.match(call.request.task,/Passage action:/);assert.ok(data.blocks.find(b=>b.n===5).selected);}
 }finally{workspace?.dispose();store.close();d.window.close();}
});

test('selection toolbar preserves the selected passage, supports keyboard arrows/Escape and obeys disabled access',async()=> {
 const d=dom(),p=document.createElement('p');p.textContent='Selected words';document.getElementById('host').append(p);const range=document.createRange();range.selectNodeContents(p);range.getBoundingClientRect=()=>({left:20,bottom:60});getSelection().addRange(range);let allowed=false;const calls=[];
 const spans={spans:[{n:3,start:0,end:8}]},toolbar=installSelectionToolbar({document,enabled:async()=>allowed,selection:async()=>spans,onAction:(action,selection)=>calls.push({action,selection})});
 try{document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,5));assert.equal(document.querySelector('[role=toolbar]'),null);allowed=true;document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,5));
 const bar=document.querySelector('[role=toolbar]'),buttons=bar.querySelectorAll('button');assert.equal(bar.hidden,false);buttons[0].focus();buttons[0].dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(document.activeElement,buttons[1]);buttons[1].click();assert.equal(calls[0].action,'Translate');assert.deepEqual(calls[0].selection,spans);assert.equal(bar.hidden,true);
 }finally{toolbar.dispose();d.window.close();}
});

test('passage worker serializes pending intentions, validates sender/navigation/permission and never overwrites an unconsumed action',async()=> {
 const {installPassages,passageKey}=await import('../extension/lib/passages.mjs');globalThis.indexedDB=new IDBFactory();const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}}),storage=memory();let allowed=true,currentURL='https://example.org/article',opens=0;
 const chrome={runtime:{id:'extension-id',onMessage:event()},tabs:{onUpdated:event(),async get(){return {id:7,url:currentURL};},async query(){return [];},async sendMessage(){}},permissions:{onAdded:event(),onRemoved:event(),async contains(){return allowed;}},scripting:{async executeScript(){}},sidePanel:{async open(){opens++;}},storage:{session:{...storage}},extension:{}};
 installPassages(chrome);const listener=chrome.runtime.onMessage.listeners[0],doc=await exampleDocument(currentURL),sender={id:'extension-id',url:currentURL,tab:{id:7,windowId:2},frameId:0};
 const message={type:'sharh:passage:invoke',action:'Explain',extraction:doc,selection:{spans:[{n:3,start:0,end:8}]}},send=(m=message,s=sender)=>new Promise(resolve=>listener(m,s,resolve));
 const replies=await Promise.all([send(),send({...message,action:'Translate'})]);assert.equal(replies.filter(r=>r.result===true).length,1);assert.equal(replies.filter(r=>r.error?.includes('waiting')).length,1);assert.equal(opens,2);const saved=(await storage.get(passageKey(2)))[passageKey(2)];assert.equal(saved.action,'Explain');assert.equal(saved.sourceTab,7);
 allowed=false;assert.match((await send()).error,/Enable passage actions/);assert.equal((await storage.get(passageKey(2)))[passageKey(2)].id,saved.id);
 allowed=true;currentURL='https://example.org/another';assert.match((await send()).error,/source page changed/);let replied=false;assert.equal(listener(message,{...sender,id:'another-extension'},()=>{replied=true;}),undefined);assert.equal(replied,false);
});
