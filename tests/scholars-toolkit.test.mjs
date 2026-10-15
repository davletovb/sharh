import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore,validateArchive} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {RecordParser} from '../src/analysis/parser.mjs';
import {assemblePrompt} from '../src/analysis/prompts.mjs';
import {customDefinition,validateFields} from '../src/analysis/contract.mjs';
import {PHASE_TWO_LENSES} from '../src/analysis/lenses.mjs';
import {buildScope,serializeScope} from '../src/documents/scopes.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {Conversations} from '../src/toolkit/conversations.mjs';
import {deepRead,secondReader,reconcile} from '../src/toolkit/workflows.mjs';
import {themeSets,alignThemes,alignLogic,agreement,namespaceRecords} from '../src/toolkit/alignment.mjs';
import {CustomLenses} from '../src/toolkit/custom-lenses.mjs';
import {markdown,runArchive} from '../src/toolkit/exports.mjs';
import {createWorkspace} from '../extension/ui/workspace.mjs';
import {createAnalysisView} from '../extension/ui/views.mjs';
import {acceptPassage} from '../extension/ui/passage-handoff.mjs';
import {runEvaluation} from '../src/evaluation/run.mjs';
import {measureOutput,metricsPass} from '../src/evaluation/metrics.mjs';
import {phaseOneOutput} from '../scripts/lib/phase-one-fixtures.mjs';
import {phaseTwoOutput} from '../scripts/lib/phase-two-fixtures.mjs';
import {exampleDocument} from './helpers/document.mjs';
const lines=(...rows)=>rows.map(JSON.stringify).join('\n')+'\n',end={t:'end'},note={t:'note',text:'The claim is supported here [¶3].',refs:[3]},target={path:'fake',provider:'fixture'},changes={addListener(){},removeListener(){}};
const entry=(r,i=0)=>({sequence:i+1,record:r,flags:[]});
function scripted(doc){let source=JSON.parse(serializeScope(doc,buildScope(doc)));return ({request})=>{if(request.document)source=JSON.parse(request.document);const task=JSON.parse(request.task.split('\n')[1]);return {text:task.operation==='ask'?lines(note,end):PHASE_TWO_LENSES.includes(task.lens)?phaseTwoOutput(task,source):phaseOneOutput(task,source)};};}
async function world(options={}){const doc=await exampleDocument(),store=await openDocumentStore({indexedDB:new IDBFactory()}),path=new FakePath({wait:async()=>{},scriptFor:scripted(doc),...options}),engine=new AnalysisEngine({store,paths:{fake:path,seatline:path}});await store.saveDocument(doc);return {doc,scope:buildScope(doc),store,path,engine,config:{doc,scope:buildScope(doc),target,persistent:path.sessions,language:'en'},close(){store.close();}};}
function memory(){let data={};return {async get(k){return {[k]:structuredClone(data[k])};},async set(v){data={...data,...structuredClone(v)};}};}
function dom(){const d=new JSDOM('<!doctype html><title>Toolkit</title><main id="host"></main>',{url:'https://example.org',pretendToBeVisual:true});for(const key of ['document','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','location'])globalThis[key]=typeof d.window[key]==='function'?d.window[key].bind(d.window):d.window[key];return d;}

test('Ask sends the scope once in a session, restores without generation, and resends it with history for stateless paths',async()=>{
 for(const sessions of [true,false]){const w=await world({sessions}),chat=new Conversations(w.engine);try{const first=await chat.ask(w.config,'What is the claim?'),second=await chat.ask(w.config,'What supports it?',{chatId:first.chatId});assert.equal(second.run.config.operation,'ask');assert.equal(w.path.calls[0].request.kind,'chat');assert.ok(w.path.calls[0].request.document);assert.equal(w.path.calls[1].request.document===null,sessions);assert.equal(w.path.calls[1].request.history.length,2);assert.equal(w.path.calls[1].request.history[0].text,'What is the claim?');const restored=await chat.open(first.chatId);assert.equal(restored.turns.length,2);assert.equal(restored.answers[0].run.id,first.run.id);assert.equal(w.path.calls.length,2);await assert.rejects(chat.ask({...w.config,language:'ar'},'Changed',{chatId:first.chatId}),/Start a new conversation/);assert.equal(w.path.calls.length,2);}finally{w.close();}}
});

test('Ask session loss before output rebuilds with scope/history and reports the restart without losing the question',async()=>{
 const w=await world(),chat=new Conversations(w.engine);try{const first=await chat.ask(w.config,'First question');w.path.handles.clear();const events=[],next=await chat.ask(w.config,'Second question',{chatId:first.chatId,onEvent:e=>events.push(e)});assert.equal(next.run.status,'completed');assert.equal(w.path.calls.length,3);assert.equal(w.path.calls[1].request.document,null);assert.ok(w.path.calls[2].request.document);assert.equal(JSON.parse(w.path.calls[2].request.task.split('\n')[1]).question,'Second question');assert.equal(w.path.calls[2].request.history.length,2);assert.ok(events.some(e=>e.type==='session_reset'));}finally{w.close();}
});

test('Ask drafts send nothing, retain their intent, and deleted drafts cannot be replayed',async()=>{
 const w=await world(),chat=new Conversations(w.engine);try{const draft=await chat.create(w.config,{passageIntentId:'intent'});assert.equal(w.path.calls.length,0);assert.equal((await chat.open(draft.id)).passageIntentId,'intent');await w.store.deleteDocument(w.doc.id);await assert.rejects(chat.ask(w.config,'Question',{chatId:draft.id}),/CHAT_REMOVED/);assert.equal((await w.store.all('chats')).length,0);assert.equal(w.path.calls.length,0);}finally{w.close();}
});

test('Deep read saves three distinct lenses and reuses only a matching target/scope session',async()=>{
 for(const sessions of [true,false]){const w=await world({sessions});try{const saved=await deepRead(w.engine,{...w.config,lens:'themes'});assert.deepEqual(saved.map(s=>s.run.lens),['structure','logic','thinking']);assert.equal(new Set(saved.map(s=>s.run.id)).size,3);assert.ok(saved.every(s=>s.run.status==='completed'));assert.deepEqual(w.path.calls.map(c=>!!c.request.document),sessions?[true,false,false]:[true,true,true]);if(sessions){await assert.rejects(w.engine.start({...w.config,scope:buildScope(w.doc,{kind:'selection',spans:[{n:3,start:0,end:5}]}),lens:'logic',followRunId:saved[0].run.id}),/SESSION_CONTEXT_CHANGED/);assert.equal(w.path.calls.length,3);}}finally{w.close();}}
});

test('Deep read cancellation between lenses leaves the completed lens and launches no next turn',async()=>{
 const w=await world(),abort=new AbortController();try{await assert.rejects(deepRead(w.engine,w.config,{signal:abort.signal,onLens:l=>{if(l==='logic')abort.abort();}}));assert.equal(w.path.calls.length,1);const rows=await w.engine.list(w.doc.id);assert.equal(rows.length,1);assert.equal(rows[0].status,'completed');}finally{w.close();}
});

test('all six G lenses have distinct trusted instructions, validate multilingual fixtures and pass raw shape gates',async()=>{
 const w=await world();try{for(const language of ['en','ru','uz-Latn','uz-Cyrl','tr','ar'])for(const lens of PHASE_TWO_LENSES){const prompt=assemblePrompt(w.doc,w.scope,{lens,language,frame:'Bourdieu'}),task=JSON.parse(prompt.request.task.split('\n')[1]),text=phaseTwoOutput(task,JSON.parse(prompt.request.document)),parser=new RecordParser({lens,blocks:w.scope.blocks});parser.push(text);const parsed=parser.finish();assert.equal(parsed.metrics.validRate,1,lens);assert.equal(metricsPass(measureOutput(text,{lens,language,doc:w.doc,scope:w.scope})),true,lens);assert.equal(task.theoreticalFrame,'Bourdieu');assert.ok(task.instructions.length>150);}}finally{w.close();}
});

test('G evaluation selects its own matrix and never marks Phase 2 accepted',async()=>{
 const w=await world();try{const report=await runEvaluation({...w,items:[{id:'one',path:'fixture',format:'html',language:'en'}],providers:['claude','codex'],lenses:PHASE_TWO_LENSES,actions:[],phase:'two',kind:'scripted',sourceCommit:'test',extract:async()=>w.doc});assert.equal(report.runs.length,12);assert.equal(report.automaticPassed,true);assert.equal(report.phaseTwoAccepted,false);assert.equal(report.liveProviderClaim,false);}finally{w.close();}
});

test('Situate keeps only source-event-backed URLs clickable; ordinary analyses cannot bless recalled URLs',async()=>{
 const url='https://example.org/review',other='https://example.org/invented',cite=u=>({t:'cite',who:'Author',role:'context',text:'External context',refs:[3],url:u}),w=await world({scriptFor:null,scripts:[{text:lines(cite(url),cite(other),end),sources:[{id:'s',title:'Review',url,snippet:'Context'}]},{text:lines(cite(url),end),sources:[{id:'s',title:'Review',url,snippet:'Context'}]}]});
 try{const found=await w.engine.start({...w.config,lens:'literature',operation:'situate'});assert.equal(w.path.calls[0].request.kind,'search');assert.ok(found.records[0].flags.includes('source_verified'));assert.ok(found.records[1].flags.includes('source_not_returned'));assert.equal(found.run.sources[0].url,url);const ordinary=await w.engine.start({...w.config,lens:'literature'});assert.ok(ordinary.records[0].flags.includes('source_not_returned'));assert.equal(validateFields(cite('javascript:alert(1)'),'literature').error,'url');const archive=runArchive(found,w.doc);archive.stores.runs[0].sources=[];assert.throws(()=>validateArchive(archive),/UNVERIFIED_SOURCE_LINK/);}finally{w.close();}
});

test('Situate continuation preserves the original search-source proof for retained citations',async()=>{
 const source={id:'s',title:'Review',url:'https://example.org/review',snippet:'Context'},cite={t:'cite',who:'A',role:'context',text:'Context',refs:[3],url:source.url},w=await world({scriptFor:null,scripts:[{text:lines(cite),truncated:true,sources:[source]},{text:lines(note,end)}]});try{const first=await w.engine.start({...w.config,lens:'literature',operation:'situate'}),continued=await w.engine.continue(first.run.id);assert.equal(continued.records[0].record.url,source.url);assert.ok(continued.records[0].flags.includes('source_verified'));assert.equal(continued.run.sources[0].url,source.url);}finally{w.close();}
});

test('theme alignment includes excerpt paragraphs, is one-to-one and computes kappa only over a sufficient universe',()=>{
 const a=[{t:'theme',id:'a',label:'A',text:'A',refs:[1,2]},{t:'code',id:'ac',theme:'a',label:'C',text:'C'},{t:'excerpt',code:'ac',ref:3,quote:'Q'},{t:'theme',id:'b',label:'B',text:'B',refs:[10]}].map(entry),b=[{t:'theme',id:'x',label:'X',text:'X',refs:[2,3]},{t:'theme',id:'y',label:'Y',text:'Y',refs:[10,11]}].map(entry),ns=Array.from({length:20},(_,i)=>i+1),result=alignThemes(a,b,ns);assert.deepEqual([...themeSets(a)[0].refs],[1,2,3]);assert.equal(result.pairs.length,2);assert.equal(result.pairs[0].left.id,'a');assert.equal(result.pairs[0].score,2/3);assert.equal(result.pairs[0].agreement.percent,95);assert.ok(Math.abs(result.pairs[0].agreement.kappa-0.7727272727272727)<1e-9);assert.equal(alignThemes(a,b,ns.slice(0,19)).pairs[0].agreement.kappa,null);assert.equal(agreement(new Set(),new Set(),ns).kappa,null);assert.equal(alignThemes(a,[...b,b[0]],ns).pairs.length,2);
});

test('Logic alignment distinguishes shared links, reference-only matches and support/attack contradictions',()=>{
 const n=(id,refs)=>({t:'node',id,kind:'claim',text:id,refs,basis:'inferred'}),left=[n('a',[1]),n('b',[2]),{t:'edge',from:'a',to:'b',rel:'supports'}].map(entry),right=[n('x',[1]),n('y',[2]),{t:'edge',from:'x',to:'y',rel:'attacks'}].map(entry),result=alignLogic(left,right);assert.equal(result.pairs.length,2);assert.equal(result.edges[0].kind,'contradiction');assert.equal(alignLogic(left,left).edges[0].kind,'both');
});

test('Second reader does not share context, namespaces colliding IDs, and saves human reconciliation without a provider turn',async()=>{
 const w=await world();try{const config={...w.config,lens:'themes'},result=await secondReader(w.engine,config,{...target,model:'other'});assert.equal(w.path.calls.length,2);assert.ok(w.path.calls.every(c=>c.request.document&&c.request.session.mode==='none'));const selected=result.outputs.flatMap((s,i)=>namespaceRecords(s.records,i?'R':'L').map(e=>`${i}:${e.sequence}`)),saved=await reconcile(w.engine,{doc:w.doc,scope:w.scope,...result,selected});assert.equal(saved.run.origin,'human-reconciliation');assert.equal(saved.records.length,8);assert.equal(w.path.calls.length,2);assert.equal(new Set(saved.records.filter(e=>e.record.id).map(e=>e.record.id)).size,4);await assert.rejects(reconcile(w.engine,{doc:w.doc,scope:w.scope,...result,selected:['0:3']}),/referenced/);await assert.rejects(reconcile(w.engine,{doc:w.doc,scope:w.scope,...result,pair:{...result.pair,sourceRuns:['wrong','wrong']},selected}),/SCOPE_CHANGED/);}finally{w.close();}
});

test('Second reader refuses an unavailable partner before spending the first reader turn',async()=>{
 const w=await world();try{await assert.rejects(secondReader(w.engine,{...w.config,lens:'themes'},{path:'fake',provider:'missing'}),/two available/);assert.equal(w.path.calls.length,0);assert.equal((await w.engine.list(w.doc.id)).length,0);}finally{w.close();}
});

test('custom lenses round-trip local definitions, whitelist record types and retain their exact contract in exported runs',async()=>{
 const definition={version:1,id:'infrastructure',name:'Infrastructure',instructions:'Read as information infrastructure; identify standards and registries.',types:['node','edge'],tier:'analysis'},storage=memory(),presets=new CustomLenses(storage);await presets.save(definition);assert.deepEqual(await new CustomLenses(storage).list(),[definition]);assert.deepEqual(await presets.import(presets.export(definition)),definition);assert.throws(()=>customDefinition({...definition,types:['script']}),/INVALID_CUSTOM/);assert.throws(()=>customDefinition({...definition,types:['edge']}),/referenced record/);await Promise.all([presets.save({...definition,id:'a'}),new CustomLenses(storage).save({...definition,id:'b'})]);assert.equal((await presets.list()).length,3);
 const w=await world({scriptFor:null,scripts:[{text:lines({t:'node',id:'n',kind:'claim',text:'A standard',refs:[3],basis:'inferred'},{t:'term',src:'not allowed',tr:'x',text:'x',refs:[3]},end)},{text:lines({t:'node',id:'n',kind:'claim',text:'A standard',refs:[3],basis:'inferred'},end)}]});try{const saved=await w.engine.start({...w.config,lens:'custom:infrastructure',customLens:definition});assert.equal(saved.run.status,'completed');assert.equal(saved.run.attempts[0].metrics.dropped.type,1);assert.equal(saved.records.length,1);assert.deepEqual(saved.run.config.customLens,definition);assert.ok(runArchive(saved,w.doc).stores.runs[0].config.customLens);const changed=assemblePrompt(w.doc,w.scope,{lens:'custom:infrastructure',customLens:{...definition,instructions:'Different instructions'}});assert.notEqual(changed.promptKey,saved.run.promptKey);}finally{w.close();}
});

test('Markdown is inert and source-linked; JSON preserves canonical records/source bytes while stripping runtime bindings',async()=>{
 const w=await world({scriptFor:null,scripts:[{text:lines({...note,text:'<svg onload=alert(1)> [unsafe] *markup*'},end)}]});try{const saved=await w.engine.start({...w.config,lens:'summary'}),text=markdown(saved,{...w.doc,address:'https://example.org/book(a)#old'});assert.ok(!text.includes('<svg'));assert.match(text,/%28a%29#sharh-paragraph=3/);const archive=runArchive(saved,w.doc,{bytes:new Uint8Array([0,255,33]),mime:'application/pdf'});assert.equal('session' in archive.stores.runs[0],false);assert.equal('cleanupGroup' in archive.stores.runs[0],false);const imported=await openDocumentStore({indexedDB:new IDBFactory()});try{await imported.importData(JSON.parse(JSON.stringify(archive)));const copy=await new AnalysisEngine({store:imported,paths:{fake:w.path}}).repository.get(saved.run.id);assert.deepEqual(copy.records,saved.records);assert.deepEqual((await imported.getSource(w.doc.id,w.doc.version)).bytes,new Uint8Array([0,255,33]));}finally{imported.close();}}finally{w.close();}
});

test('views render codebooks/citations/glossaries, reject recalled hyperlinks, and highlight paragraphs only on the matching saved extraction',async()=>{
 const d=dom(),w=await world(),host=document.getElementById('host');let view;try{for(const lens of ['themes','literature','terms']){view=createAnalysisView(host,{lens,doc:w.doc,workerFactory:()=>{throw Error('no worker');}});const parser=new RecordParser({lens,blocks:w.scope.blocks});parser.push(phaseTwoOutput({lens,outputLanguage:'en'},JSON.parse(serializeScope(w.doc,w.scope))));for(const e of parser.finish().records)view.record(e);await view.settled();assert.ok(host.querySelector('table tbody tr'));view.dispose();}
 view=createAnalysisView(host,{lens:'literature',doc:w.doc});view.record({sequence:1,record:{t:'cite',who:'A',role:'context',text:'x',refs:[3],url:'https://example.org/'},flags:['source_not_returned']});await view.settled();assert.equal(host.querySelector('a'),null);view.setVisibleParagraphs([3]);assert.ok(host.querySelector('.in-source-view'));view.setVisibleParagraphs([4]);assert.equal(host.querySelector('.in-source-view'),null);
 }finally{view?.dispose();w.close();d.window.close();}
});

test('workspace Ask-from-toolbar acknowledges one draft, restores a repeated handoff, and opens studio state without replay',async()=>{
 const d=dom(),w=await world(),storage=memory(),session=memory();session.remove=async key=>session.set({[key]:undefined});let workspace;
 try{workspace=await createWorkspace(document.getElementById('host'),{store:w.store,engine:w.engine,client:{call:async m=>m==='discover'?w.path.discover():null},storage,changes});await workspace.ready;await workspace.setDocument(w.doc);const key='pending',intent={id:'ask-intent',docId:w.doc.id,version:w.doc.version,action:'Ask about this',selection:{spans:[{n:5,start:0,end:8}]}};await session.set({[key]:intent});
 const handoff=()=>acceptPassage({key,storage:session,store:w.store,engine:w.engine,show:()=>workspace.setDocument(w.doc),onPassage:(...args)=>workspace.passage(...args),onAsk:id=>workspace.openChat(id)}),result=await handoff();assert.ok(result.chatId);assert.equal((await session.get(key))[key],undefined);assert.equal(w.path.calls.length,0);const chat=(await w.store.all('chats'))[0];assert.equal(chat.scope.kind,'selection');assert.equal(document.querySelector('.chat-transcript').closest('.workspace-area').hidden,false);
 await session.set({[key]:intent});assert.equal((await handoff()).restored,true);assert.equal((await w.store.all('chats')).length,1);assert.equal((await session.get(key))[key],undefined);await workspace.restoreStudio({docId:w.doc.id,version:w.doc.version,chatId:chat.id,scope:chat.scope,area:'ask'});assert.equal(w.path.calls.length,0);
 }finally{workspace?.dispose();w.close();d.window.close();}
});
