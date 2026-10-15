import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {openDocumentStore,validateArchive} from '../src/documents/store.mjs';
import {transaction} from '../src/documents/idb.mjs';
import {createDocument,versionOf,makeSections} from '../src/documents/model.mjs';
import {buildScope,serializeScope} from '../src/documents/scopes.mjs';
import {assemblePrompt} from '../src/analysis/prompts.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {MaintenanceDispatcher} from '../src/analysis/maintenance.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {MAX_REQUEST_BYTES} from '../src/paths/limits.mjs';
import {targetKey} from '../src/paths/targets.mjs';
import {BookJobs} from '../src/across/books.mjs';
import {AcrossTexts,collectionDocument} from '../src/across/synthesis.mjs';
import {Library} from '../src/across/library.mjs';
import {Glossary,glossarySnapshot,MAX_GLOSSARY_BYTES} from '../src/across/glossary.mjs';
import {runWithFailover} from '../src/across/failover.mjs';
import {Conversations} from '../src/toolkit/conversations.mjs';
import {markdown,runArchive} from '../src/toolkit/exports.mjs';
import {createWorkspace} from '../extension/ui/workspace.mjs';
import {createAcrossTexts} from '../extension/ui/across-texts.mjs';
import {phaseThreeOutput} from '../scripts/lib/phase-three-fixtures.mjs';

const target={path:'seatline',provider:'claude'},end={t:'end'},lines=(...rows)=>rows.map(JSON.stringify).join('\n')+'\n';
const info=provider=>({path:'seatline',provider,available:true,signedIn:true,accepted:true,models:[],capabilities:{toolIsolation:true,sessions:true,webSearch:true,effort:['low','medium','high'],serviceTier:['standard','fast']}});
async function source(identity='review',texts=['Chapter 1','Evidence in the first chapter.','Chapter 2','Evidence in the second chapter.','Chapter 3','Evidence in the third chapter.'],headings=true){const blocks=texts.map((text,i)=>({n:i+1,kind:headings&&i%2===0?'heading':'para',...(headings&&i%2===0?{level:1}:{}),text,anchor:{type:'html',path:`p:nth-child(${i+1})`,quote:{exact:text,prefix:'',suffix:''},position:{start:i*100000,end:i*100000+text.length}}}));return createDocument({extractorVersion:'review',version:await versionOf(identity,JSON.stringify(blocks)),blocks,sections:makeSections(blocks)},{kind:'html',identity,title:identity,language:'en'});}
async function world(){const store=await openDocumentStore({indexedDB:new IDBFactory(),name:crypto.randomUUID()}),doc=await source();await store.saveDocument(doc);const path=new FakePath({wait:async()=>{},scriptFor:({request})=>{const task=JSON.parse(request.task.split('\n')[1]);return {text:task.operation==='ask'?lines({t:'note',text:'Grounded answer.',refs:[2]},end):phaseThreeOutput(task,JSON.parse(request.document))};}});path.discover=async()=>[info('claude'),info('codex')];const engine=new AnalysisEngine({store,paths:{seatline:path}});await engine.ready;return {store,doc,path,engine,config:{doc,scope:buildScope(doc),target,language:'en'},close(){store.close();}};}
const entry=(record,i)=>({record,sequence:i+1,flags:[]});
const memory=()=>{let data={};return {get:async k=>({[k]:structuredClone(data[k])}),set:async v=>Object.assign(data,structuredClone(v))};};
function dom(){const d=new JSDOM('<main></main>',{url:'https://example.org',pretendToBeVisual:true});for(const k of ['document','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','location'])globalThis[k]=typeof d.window[k]==='function'?d.window[k].bind(d.window):d.window[k];return d;}
async function until(predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for workflow.');}
async function seed(store,rows){await transaction(store.db,'glossary','readwrite',tx=>{for(const row of rows)tx.objectStore('glossary').put(row);});}

test('large glossaries remain usable in previews, passage runs, chat and chapter jobs within a UTF-8 byte budget',async()=>{
 const w=await world();try{
  const terms=Array.from({length:1001},(_,i)=>'term'+i),doc=await source('large-glossary',['Heading','Evidence '+terms.join(' ')]);await w.store.saveDocument(doc);
  const rows=[{bookId:doc.id,term:'dalil',translation:'evidence',aliases:['Evidence','далил'],note:'𐐀'.repeat(700),language:'en'},...terms.map(term=>({bookId:doc.id,term,translation:'x'.repeat(1200),note:'𐐀'.repeat(700),aliases:[],language:'en'}))];await seed(w.store,rows);
  const config={...w.config,doc,scope:buildScope(doc)},prompt=w.engine.preview({...config,lens:'digest',glossary:glossarySnapshot(rows,'en')});assert.ok(prompt.fits);assert.ok(prompt.config.glossary.length<1000);assert.ok(Buffer.byteLength(JSON.stringify(prompt.config.glossary))<=MAX_GLOSSARY_BYTES);assert.equal(prompt.config.glossary[0].term,'dalil');
  const scope=buildScope(doc,{kind:'selection',spans:[{n:2,start:0,end:8}]}),passage=await w.engine.start({...config,scope,lens:'passage',operation:'ask',question:'Meaning?'});assert.equal(passage.run.status,'completed');assert.deepEqual(passage.run.config.glossary.map(r=>r.term),['dalil']);
  const chats=new Conversations(w.engine),first=await chats.ask({...config,scope,persistent:true},'Meaning?');assert.equal(first.run.status,'completed');const next=await chats.ask({...config,scope,persistent:true},'More?',{chatId:first.chatId});assert.equal(next.run.status,'completed');assert.equal(w.path.calls.at(-1).request.session.mode,'continue');const books=new BookJobs(w.engine),job=await books.create(config);assert.equal((await books.run(job.id)).state,'completed');assert.equal((await new Glossary(w.store).list(doc.id)).length,rows.length);
 }finally{w.close();}
});

test('automatic glossary capture caps growth and accepts canonical astral text; capture errors cannot reject a completed run',async t=>{
 const w=await world(),glossary=new Glossary(w.store);try{
  await seed(w.store,Array.from({length:999},(_,i)=>({bookId:w.doc.id,term:'old'+i,translation:'x',aliases:[],note:'',language:'en'})));
  await glossary.capture({run:{docId:w.doc.id,status:'completed',config:{language:'en'}},records:[0,1,2].map(i=>entry({t:'term',src:'new'+i,tr:'𐐀'.repeat(700),text:'𐐀'.repeat(700),refs:[2]},i))});assert.equal((await glossary.list(w.doc.id)).length,1000);assert.equal((await glossary.list(w.doc.id)).find(r=>r.term==='new0').note.length,1400);
  w.path.scriptFor=()=>({text:lines({t:'term',src:'Evidence',tr:'𐐀'.repeat(700),text:'𐐀'.repeat(700),refs:[2]},end)});const warnings=[];t.mock.method(Glossary.prototype,'capture',async()=>{throw Error('IDB_WRITE_FAILED');});const saved=await w.engine.start({...w.config,lens:'terms'},{onEvent:e=>warnings.push(e)});assert.equal(saved.run.status,'completed');assert.equal((await w.engine.repository.get(saved.run.id)).run.status,'completed');assert.ok(warnings.some(e=>e.type==='glossary_warning'&&e.code==='IDB_WRITE_FAILED'));assert.equal(w.path.calls.length,1);
 }finally{w.close();}
});

test('collection digests are emitted once per record, keep all original refs and omit private source metadata from prompts',async()=>{
 const w=await world();try{
  const a=await source('a',Array.from({length:120},(_,i)=>'Paragraph '+i),false),b=await source('b',Array.from({length:120},(_,i)=>'Paragraph '+i),false);a.address='/private/research/book.pdf';b.address='https://private.example.org/token-secret';await w.store.saveDocument(a);await w.store.saveDocument(b);const lib=new Library(w.store),items=[await lib.save(a),await lib.save(b)],digests=items.map(item=>({itemId:item.id,chapters:Array.from({length:10},(_,chapter)=>({title:'Chapter '+chapter,runId:crypto.randomUUID(),records:Array.from({length:24},(_,i)=>entry({t:'sum',level:'section',text:'x'.repeat(1000),refs:Array.from({length:10},(_,n)=>chapter*12+n+1)},i))}))})),doc=await collectionDocument(w.store,items,{kind:'meta-synthesis',digests});
  assert.equal(doc.blocks.length,480);assert.equal(doc.blocks.filter(block=>block.source.itemId===items[0].id).length,240);assert.deepEqual(doc.blocks[0].source.refs,[1,2,3,4,5,6,7,8,9,10]);const wire=serializeScope(doc,buildScope(doc));assert.ok(Buffer.byteLength(wire)<700000);for(const value of [a.id,a.version,a.address,b.address])assert.equal(wire.includes(value),false);const data=JSON.parse(wire);assert.equal(data.items.length,2);assert.deepEqual(data.blocks[0].originalRefs,[1,2,3,4,5,6,7,8,9,10]);assert.equal(data.blocks[0].item,items[0].id);
  const saved=await new AcrossTexts(w.engine).run(doc,{target,language:'en'});assert.equal(saved.run.status,'completed');assert.match(markdown(saved,doc),/¶10/);const archive=runArchive(saved,doc,null,[{doc:a},{doc:b}]);assert.doesNotThrow(()=>validateArchive(archive));const bad=structuredClone(archive);bad.stores.blocks.find(block=>block.source).source.refs[1]=999;assert.throws(()=>validateArchive(bad),/SOURCE_REFERENCE/);
 }finally{w.close();}
});

test('book synthesis keeps using its frozen extraction after a new extraction becomes current',async()=>{
 const w=await world(),books=new BookJobs(w.engine);try{const job=await books.create(w.config);await books.run(job.id);await w.store.saveDocument(await source('review',['Updated heading','Changed evidence.']));for(const lens of ['summary','structure','logic','thinking']){const saved=await books.synthesize(job.id,{target,language:'en',lens});assert.equal(saved.run.status,'completed');assert.equal(saved.run.extractionVersion,w.doc.version);assert.equal(saved.run.stale,true);}}finally{w.close();}
});

test('matching job manifests survive repeated preparation and ambiguous runs cannot be bypassed by a fresh manifest',async()=>{
 const w=await world(),books=new BookJobs(w.engine),lib=new Library(w.store);try{
  const job=await books.create(w.config),chapter=job.chapters[0],scope={...chapter.scope,blocks:w.doc.blocks.filter(b=>b.n>=chapter.span[0]&&b.n<=chapter.span[1])},run=await w.engine.repository.begin(w.doc,scope,assemblePrompt(w.doc,scope,{...job.config,lens:'digest',priority:'background'}),target);chapter.runId=run.id;job.state='running';await books.write(job);
  assert.equal((await books.list())[0].state,'paused');assert.equal((await w.engine.repository.get(run.id)).run.status,'interrupted');assert.equal((await books.create(w.config)).id,job.id);
  const other=await source('other');await w.store.saveDocument(other);const items=[await lib.save(w.doc),await lib.save(other)];await assert.rejects(new AcrossTexts(w.engine).prepare(items,{target,kind:'literature-review'}),{code:'AMBIGUOUS_CHAPTER'});assert.equal(w.path.calls.length,0);assert.equal((await books.list()).length,1);
  const changed=await books.create({...w.config,focus:'A new angle'});assert.notEqual(changed.id,job.id);await assert.rejects(books.run(changed.id),{code:'AMBIGUOUS_CHAPTER'});assert.equal(w.path.calls.length,0);const saved=await books.run(changed.id,{restartInterruptedRunId:run.id});assert.equal(saved.state,'completed');assert.equal(w.path.calls.length,3);assert.equal((await w.engine.repository.get(run.id)).run.restartedBy,saved.chapters[0].runId);
 }finally{w.close();}
});

test('repeated completed collection preparations reuse their jobs and digests',async()=>{
 const w=await world(),lib=new Library(w.store),across=new AcrossTexts(w.engine);try{const other=await source('other');await w.store.saveDocument(other);const items=[await lib.save(w.doc),await lib.save(other)];for(const kind of ['literature-review','meta-synthesis','literature-review'])await across.prepare(items,{target,kind});assert.equal((await new BookJobs(w.engine).list()).length,2);assert.equal(w.path.calls.length,6);}finally{w.close();}
});

test('failover skips seats without search, effort or service-tier support before asking or launching',async()=>{
 const w=await world();try{
  const candidates=[{path:'seatline',provider:'grok'},{path:'seatline',provider:'claude',effort:'xhigh'},{path:'seatline',provider:'codex',serviceTier:'fast'},{path:'seatline',provider:'codex',effort:'high',serviceTier:'standard'}];w.path.discover=async()=>[info('claude'),{...info('grok'),capabilities:{...info('grok').capabilities,webSearch:false}},{...info('codex'),capabilities:{...info('codex').capabilities,serviceTier:['standard']}}];let first=true;w.path.scriptFor=()=>first?(first=false,{error:{code:'RATE_LIMITED',reason:'PROVIDER_RATE_LIMITED'}}):{text:lines({t:'cite',who:'Author',role:'context',text:'Grounded use.',refs:[2]},end)};const asked=[];const saved=await runWithFailover(w.engine,{...w.config,lens:'literature',operation:'situate'},{mode:'ask',targets:candidates},{approveFailover:async({to})=>{asked.push(to.provider);return true;}});assert.equal(saved.run.status,'completed');assert.deepEqual(asked,['codex']);assert.deepEqual(w.path.calls.map(c=>c.target.provider),['claude','codex']);assert.equal((await w.engine.list(w.doc.id)).length,2);
 }finally{w.close();}
});

test('full imports merge different library contents and older backups without hiding real item conflicts',async()=>{
 const a=await world(),b=await world(),lib=new Library(a.store);try{
  const first=await lib.save(a.doc),backup=await a.store.exportData();await lib.save(a.doc,buildScope(a.doc,{kind:'chapter',id:a.doc.sections[0].id}));await a.store.importData(backup);assert.equal((await lib.items()).length,2);
  await b.store.deleteDocument(b.doc.id);const other=await source('imported');await b.store.saveDocument(other);const incoming=await new Library(b.store).save(other);await a.store.importData(await b.store.exportData());assert.equal((await lib.items()).length,3);assert.ok((await lib.items()).some(i=>i.id===incoming.id));const bad=structuredClone(backup);bad.stores.collections.find(c=>c.kind==='library').items[0].title='Conflicting title';await assert.rejects(a.store.importData(bad),/IMPORT_CONFLICT/);assert.equal((await lib.items()).find(i=>i.id===first.id).title,first.title);assert.equal((await lib.items()).length,3);
 }finally{a.close();b.close();}
});

test('headingless oversized books split into bounded paragraph parts before a job is saved',async()=>{
 const w=await world(),books=new BookJobs(w.engine);try{const doc=await source('headingless',Array.from({length:300},(_,i)=>`Paragraph ${i}. `+'x'.repeat(6000)),false);await w.store.saveDocument(doc);const job=await books.create({...w.config,doc,scope:buildScope(doc)});assert.ok(job.chapters.length>1);assert.deepEqual(job.chapters.flatMap(c=>c.scope.blocks.map(b=>b.n)),Array.from({length:300},(_,i)=>i+1));const saved=await books.run(job.id);assert.equal(saved.state,'completed');assert.equal(w.path.calls.length,job.chapters.length);for(const call of w.path.calls)assert.ok(w.engine.preview({...saved.config,doc,scope:{...saved.chapters.find(c=>c.title===JSON.parse(call.request.document).scope).scope,blocks:JSON.parse(call.request.document).blocks},target,lens:'digest',priority:'background'}).requestBytes<=MAX_REQUEST_BYTES);}finally{w.close();}
});

test('new collections append after deletion without order ties',async()=>{
 const w=await world(),lib=new Library(w.store);try{await lib.save(w.doc);const a=await lib.create('A'),b=await lib.create('B'),c=await lib.create('C');await lib.delete(b.id);const d=await lib.create('D'),rows=await lib.collections();assert.deepEqual(rows.map(r=>r.id),[a.id,c.id,d.id]);assert.equal(new Set(rows.map(r=>r.order)).size,3);}finally{w.close();}
});

test('collection deletion returns cleanup refs and its control immediately drains persistent sessions',async()=>{
 const d=dom(),w=await world(),lib=new Library(w.store);let across;try{
  const first=await lib.save(w.doc),second=await lib.save(w.doc,buildScope(w.doc,{kind:'chapter',id:w.doc.sections[1].id})),collection=await lib.create('Delete me'),doc=await collectionDocument(w.store,[first,second],{kind:'compare',collectionId:collection.id});await w.engine.start({...w.config,doc,scope:buildScope(doc),lens:'compare',persistent:true});assert.equal(w.path.handles.size,1);let drains=0;const dispatcher=new MaintenanceDispatcher(w.store,{seatline:w.path}),hosts=Array.from({length:3},()=>{const el=document.createElement('div');document.querySelector('main').append(el);return el;});across=await createAcrossTexts({library:hosts[0],analyze:hosts[1],modelHost:hosts[2],store:w.store,engine:w.engine,storage:memory(),api:{maintenance:async()=>{drains++;await dispatcher.drain();},refreshRuns:async()=>{},fail:error=>{throw error;}}});const select=[...hosts[0].querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===collection.id));select.value=collection.id;[...hosts[0].querySelectorAll('button')].find(b=>b.textContent==='Delete collection').click();await until(()=>drains===1&&w.path.handles.size===0);assert.equal(await w.store.getDocument(doc.id),null);assert.equal((await w.store.all('maintenance')).length,0);
  const c=await lib.create('Another'),report=await collectionDocument(w.store,[first,second],{kind:'compare',collectionId:c.id});await w.engine.start({...w.config,doc:report,scope:buildScope(report),lens:'compare',persistent:true});const refs=await lib.delete(c.id);assert.ok(Array.isArray(refs.handles)&&refs.handles.length===1);assert.ok(Array.isArray(refs.groups)&&refs.groups.length>0);
 }finally{across?.dispose();w.close();d.window.close();}
});

test('indexed glossary/job reads and one digest-history read per book avoid whole-store scans',async t=>{
 const w=await world(),books=new BookJobs(w.engine);try{const job=await books.create(w.config),all=w.store.all.bind(w.store),list=w.engine.list.bind(w.engine);let scans=0;t.mock.method(w.store,'all',name=>{assert.ok(!['jobs','glossary'].includes(name));return all(name);});t.mock.method(w.engine,'list',async id=>{scans++;return list(id);});assert.equal((await books.get(job.id)).id,job.id);assert.deepEqual(await new Glossary(w.store).list(w.doc.id),[]);assert.equal((await books.run(job.id)).state,'completed');assert.equal(scans,1);}finally{w.close();}
});

test('matrix captions, original multi-ref navigation and target identity stay consistent in the workspace',async()=>{
 const d=dom(),w=await world(),lib=new Library(w.store);let workspace;try{
  const other=await source('other');await w.store.saveDocument(other);const items=[await lib.save(w.doc),await lib.save(other)],digests=items.map(item=>({itemId:item.id,chapters:[{title:'Chapter',runId:crypto.randomUUID(),records:[entry({t:'sum',level:'section',text:'Shared evidence.',refs:[2,4]},0)]}]})),report=await collectionDocument(w.store,items,{kind:'meta-synthesis',digests}),saved=await new AcrossTexts(w.engine).run(report,{target}),refs=[];
  workspace=await createWorkspace(document.querySelector('main'),{store:w.store,engine:w.engine,client:{call:async method=>method==='discover'?w.path.discover():null},storage:memory(),changes:{addListener(){},removeListener(){}},onReference:(block,doc)=>refs.push({n:block.n,id:doc.id})});await workspace.ready;await workspace.setDocument(report);await workspace.view.settled();assert.equal(document.querySelector('caption').textContent,'Evidence matrix');const link=[...document.querySelectorAll('.reference')].find(b=>b.textContent==='review · ¶4');assert.ok(link);link.click();await until(()=>refs.length===1);assert.deepEqual(refs[0],{n:4,id:w.doc.id});assert.equal((await w.engine.repository.get(saved.run.id)).run.status,'completed');
  const books=new BookJobs(w.engine),job=await books.create(w.config);await books.run(job.id);const synthesis=await books.synthesize(job.id,{target,lens:'summary'});synthesis.run.config.digests[1].target={provider:'claude',label:'Extra UI label',path:'seatline'};await w.engine.repository.write(synthesis.run.id,{config:synthesis.run.config});await workspace.setDocument(w.doc);assert.doesNotMatch(document.querySelector('.run-metadata').textContent,/mixed digest targets/);assert.equal(targetKey(target),targetKey(synthesis.run.config.digests[1].target));
 }finally{workspace?.dispose();w.close();d.window.close();}
});
