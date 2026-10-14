import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import contract from '../config/seatline-contract.json' with {type:'json'};
import {openDocumentStore} from '../src/documents/store.mjs';
import {transaction} from '../src/documents/idb.mjs';
import {buildScope,scopeSize} from '../src/documents/scopes.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {RecordParser} from '../src/analysis/parser.mjs';
import {RunRepository} from '../src/analysis/storage.mjs';
import {MaintenanceDispatcher} from '../src/analysis/maintenance.mjs';
import {assemblePrompt,continuationTask} from '../src/analysis/prompts.mjs';
import {requestPreview} from '../src/analysis/requests.mjs';
import {validateFields} from '../src/analysis/contract.mjs';
import {verifyQuotation} from '../src/analysis/quotes.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {MAX_REQUEST_BYTES,measureRequest} from '../src/paths/limits.mjs';
import {generationFrame} from '../src/paths/seatline.mjs';
import {exampleDocument} from './helpers/document.mjs';
const target={path:'fake',provider:'fixture',model:'fixture'};
const node=(id='a',extra={})=>({t:'node',id,kind:'claim',text:'A finding',refs:[3],basis:'stated',...extra});
const jsonl=(...rows)=>rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n';
const end={t:'end'},instant=async()=>{},deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function setup(scripts,options={}) {
  const store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument(),scope=buildScope(doc);await store.saveDocument(doc);
  const path=new FakePath({scripts,wait:instant,...options}),engine=new AnalysisEngine({store,paths:{fake:path}});await engine.ready;
  return {store,doc,scope,path,engine,start:(extra={},events={})=>engine.start({doc,scope,target,lens:'logic',...extra},events)};
}

test('optional null/blank fields are omitted while required fields still validate',()=> {
  const cases=[['structure',{t:'sec',id:'a',parent:null,title:'Root',role:'claim',gist:'x',span:[1,3]}],['summary',{t:'sum',level:'section',sec:null,text:'x',refs:[3]}],
    ['logic',node('a',{quote:''})],['logic',node('a',{quote:' \u0000 '})],['literature',{t:'cite',who:'Author',work:null,role:'foil',text:'x',refs:[3]}],
    ['thinking',{t:'concept',id:'a',term:'x',src:null,gloss:'x',refs:[3]}],['logic',{t:'note',text:'x',refs:null}],['logic',{t:'edge',from:'a',to:'b',rel:'supports',text:''}]];
  for(const [lens,row] of cases) {const result=validateFields(row,lens);assert.ok(result.record,JSON.stringify(row));for(const [k,v] of Object.entries(row))if(v===null || typeof v==='string' && !v.trim())assert.equal(Object.hasOwn(result.record,k),false);}
  assert.ok(validateFields(node('a',{text:null}),'logic').error);assert.ok(validateFields(node('a',{refs:null}),'logic').error);
  assert.ok(validateFields({t:'note',text:'x',refs:''},'logic').error);
  const parser=new RecordParser({lens:'structure',blocks:[{n:1,text:'Root'},{n:2,text:'Body'},{n:3,text:'End'}]});parser.push(jsonl(cases[0][1],end));assert.equal(parser.finish().metrics.validRate,1);
});

test('ASCII, spaced and Unicode ellipses match ordered segments across the supported scripts',()=> {
  for(const [source,a,b] of [['The quick brown fox jumps over the lazy dog.','The quick','lazy dog'],['Чтение приносит пользу всем людям.','Чтение','людям'],
    ['Oʻqish hamma uchun juda foydali.','O\'qish','foydali'],['Ўқиш ҳамма учун жуда фойдали.','Ўқиш','фойдали'],['Okumak herkes için çok faydalıdır.','Okumak','faydalıdır'],['القراءة نافعة لكل الناس.','القراءة','الناس']]) {
    for(const dots of ['…','...','. . .'])assert.equal(verifyQuotation(a+' '+dots+' '+b,[1],[{n:1,text:source}]),true,source+dots);
  }
  assert.equal(verifyQuotation('lazy dog ... quick',[1],[{n:1,text:'The quick brown fox jumps over the lazy dog.'}]),false);
});

test('end-only output completes empty lenses and continuations without repair; trailing chatter is diagnostic',async()=> {
  const s=await setup([{text:jsonl(end)},{text:jsonl(node()),truncated:true},{text:jsonl(end)},{text:jsonl(node('a'),node('b'),node('c'),end,'Hope this helps!')}]);
  try {
    const empty=await s.start();assert.equal(empty.run.status,'completed');assert.equal(empty.run.metrics.emptyCompletion,true);assert.equal(empty.records.length,0);
    const first=await s.start(),done=await s.engine.continue(first.run.id);assert.equal(done.run.status,'completed');assert.equal(done.records.length,1);assert.equal(done.run.canContinue,false);
    const chatter=await s.start();assert.equal(chatter.run.status,'completed');assert.equal(chatter.run.metrics.validRate,1);assert.equal(chatter.run.metrics.truncated,false);assert.equal(chatter.run.metrics.skipped.after_end,1);assert.equal(s.path.calls.length,4);
  }finally{s.store.close();}
});

test('a repair capped below the initial valid-record count never discards the larger useful attempt',async()=> {
  const rows=Array.from({length:150},(_,i)=>node('n'+i,{text:'x'.repeat(400)}));
  const s=await setup([{text:jsonl(...rows,...Array(50).fill('{bad}'),end)},{text:jsonl(...rows,end)}]);
  try {const events=[],result=await s.start({}, {onEvent:e=>events.push(e)});assert.equal(result.records.length,150);assert.deepEqual(result.records.map(e=>e.record.id),rows.map(r=>r.id));
    assert.ok(result.run.attempts[1].metrics.newValidRecords<150);assert.equal(result.run.attempts[1].accepted,false);assert.equal(result.run.attempts[1].rejection,'FEWER_VALID_RECORDS');assert.ok(events.some(e=>e.type==='repair_failed'));assert.ok(!events.some(e=>e.type==='reset'));}
  finally{s.store.close();}
});

test('canonical history is cloned directly and corrupt history fails atomically without contaminating preceding flags',()=> {
  const blocks=[{n:3,text:'Source'}],p=new RecordParser({lens:'logic',blocks});p.push(jsonl(node('a',{quote:'not found'}),node('b'),end));const old=p.finish().records;
  const seen=[],next=new RecordParser({lens:'logic',blocks,onRecord:e=>seen.push(e)});next.seed(old);assert.deepEqual(seen.map(e=>e.flags),old.map(e=>e.flags));
  old[0].record.text='Changed caller';assert.notEqual(seen[0].record.text,old[0].record.text);
  const callbacks=[],bad=new RecordParser({lens:'logic',blocks,onRecord:e=>callbacks.push(e)}),corrupt={sequence:2,record:{t:'node',id:'bad'},flags:['quotation_not_found']};
  assert.throws(()=>bad.seed([old[1],corrupt]),/INVALID_RETAINED_RECORD/);assert.deepEqual(callbacks,[]);assert.deepEqual(bad.entries,[]);assert.deepEqual(old[1].flags,[]);
});

test('portable imports reject corrupt canonical D records and strip every owned session binding',async()=> {
  const s=await setup([{text:jsonl(node(),end)}]);
  try {
    const run=await s.start();await s.engine.repository.write(run.run.id,{session:{handle:'owned',reusable:false},sessionHandles:['owned','old'],cleanupGroup:'doc-owned'});
    const archive=await s.store.exportData();for(const k of ['session','sessionHandles','cleanupGroup'])assert.equal(Object.hasOwn(archive.stores.runs[0],k),false);
    const bad=structuredClone(archive);delete bad.stores.records[0].record.text;const targetStore=await openDocumentStore({indexedDB:new IDBFactory()});
    try {
      await assert.rejects(targetStore.importData(bad),/INVALID_RETAINED_RECORD/);assert.equal((await targetStore.all('runs')).length,0);
      const forged=structuredClone(archive);forged.stores.records[0].record.quote='A forged verified quote';await assert.rejects(targetStore.importData(forged),/INVALID_ARCHIVE_QUOTATION/);
    }finally{targetStore.close();}
  }finally{s.store.close();}
});

test('orphaned continuation owners recover on load and the latest interrupted version can continue',async()=> {
  const s=await setup([{text:jsonl(node('a')),truncated:true},{text:jsonl(node('c'),end)}]);
  try {
    const initial=await s.start(),prompt=assemblePrompt(s.doc,s.scope,{lens:'logic'});
    const orphan=await s.engine.repository.begin(s.doc,s.scope,prompt,target,{previousId:initial.run.id});
    await s.engine.repository.write(orphan.id,{},[...initial.records,{sequence:2,record:node('b'),flags:[]}]);
    const replacement=new AnalysisEngine({store:s.store,paths:{fake:s.path}});await replacement.ready;
    const recovered=await replacement.repository.get(orphan.id);assert.equal(recovered.run.status,'interrupted');assert.equal(recovered.run.canContinue,true);assert.equal(recovered.records.length,2);
    const next=await replacement.continue(orphan.id);assert.equal(next.run.status,'completed');assert.equal(next.run.previousId,orphan.id);assert.equal(next.records.length,3);
    assert.equal((await replacement.repository.get(initial.run.id)).run.continuedBy,orphan.id);
  }finally{s.store.close();}
});

test('recovery never steals an owner that is still running in another engine',async()=> {
  const gate=deferred(),running=deferred(),s=await setup([{text:jsonl(node(),end)}]);let id;
  s.path.wait=()=>gate.promise;
  const work=s.start({}, {onEvent:e=>{if(e.type==='run' && e.status==='running'){id=e.runId;running.resolve();}}});
  try {await running.promise;const other=new AnalysisEngine({store:s.store,paths:{fake:s.path}});await other.ready;assert.equal((await other.repository.get(id)).run.status,'running');await assert.rejects(other.continue(id),/CONTINUATION_UNAVAILABLE/);gate.resolve();assert.equal((await work).run.status,'completed');}
  finally{gate.resolve();await work.catch(()=>{});s.store.close();}
});

test('transient storage errors finalize as interrupted and remain explicitly resumable',async()=> {
  const s=await setup([{text:jsonl(node(),end)},{text:jsonl(node('new'),end)}]),write=s.engine.repository.write.bind(s.engine.repository);let once=true,id;
  s.engine.repository.write=(...args)=>{if(once && args[2]?.length){once=false;return Promise.reject(Error('TEMPORARY_STORAGE_ERROR'));}return write(...args);};
  try {await assert.rejects(s.start({}, {onEvent:e=>{if(e.type==='run')id=e.runId;}}),/TEMPORARY_STORAGE_ERROR/);const saved=await s.engine.repository.get(id);assert.equal(saved.run.status,'interrupted');assert.equal(saved.run.canContinue,true);assert.equal((await s.engine.continue(id)).run.status,'completed');}
  finally{s.store.close();}
});

test('a cancellation has exactly one terminal event and late cancellation leaves attempt metrics immutable',async()=> {
  for(const duringRepair of [false,true]) {
    const s=await setup([{chunks:[jsonl(node(),...(duringRepair?['{bad}','{bad}',end]:[])),jsonl(end)]},{text:jsonl(node('fixed'),end)}]),abort=new AbortController(),statuses=[];let id;
    try {await assert.rejects(s.start({}, {signal:abort.signal,onEvent:e=> {
      if(e.type==='run'){id=e.runId;statuses.push(e.status);}if(duringRepair?e.type==='repairing':e.type==='record')abort.abort();
    }}),{code:'CANCELLED'});
      const saved=await s.engine.repository.get(id);assert.deepEqual(statuses,['running','cancelled']);assert.equal(saved.run.status,'cancelled');assert.equal(saved.run.metrics.truncated,true);
      if(duringRepair)assert.equal(saved.run.attempts[0].metrics.truncated,false);
    }finally{s.store.close();}
  }
});

test('session loss before any output reconstructs the scope once even if a contextless answer arrives later',async()=> {
  const s=await setup([{text:jsonl(node('old')),truncated:true},{text:jsonl(node('fresh'),end)}]),original=s.path.run.bind(s.path);let rebuilt=false;
  s.path.run=async(t,r,o)=> {
    if(r.session.mode==='continue') {
      s.path.calls.push(structuredClone({target:t,request:r}));o.onEvent({type:'session_lost',confirmed:true});
      const text=jsonl(node('contextless'),end);o.onEvent({type:'delta',text});o.onEvent({type:'session_lost',confirmed:true});return {text,session:null,target:t};
    }
    if(s.path.calls.length)rebuilt=r.session.mode==='start' && !!r.document;
    return original(t,r,o);
  };
  try {const first=await s.start({persistent:true}),events=[],next=await s.engine.continue(first.run.id,{onEvent:e=>events.push(e)});assert.ok(rebuilt);assert.equal(s.path.calls.length,3);assert.equal(next.run.status,'completed');assert.ok(events.some(e=>e.type==='session_reset'));assert.ok(!next.records.some(e=>e.record.id==='contextless'));assert.equal(next.records.length,2);}
  finally{s.store.close();}
});

test('successful repair preserves nonreusable session ownership for deletion and exports never carry it',async()=> {
  const s=await setup([{text:jsonl(node(),'{bad}','{bad}',end)},{text:jsonl(node(),end)}]);
  const seat={path:'seatline',provider:'claude',model:null};s.path.discover=async()=>[{provider:'claude',capabilities:{sessions:true}}];s.engine.paths={seatline:s.path};
  try {const result=await s.start({target:seat,persistent:true});assert.equal(result.run.session.reusable,false);assert.ok(result.run.sessionHandles.includes(result.run.session.handle));
    const archive=await s.store.exportData();assert.equal(archive.stores.runs[0].sessionHandles,undefined);await s.store.deleteDocument(s.doc.id);const rows=await s.store.all('maintenance');
    assert.ok(rows.some(r=>r.method==='forget' && r.handle===result.run.session.handle));assert.ok(rows.some(r=>r.method==='cleanup'));
  }finally{s.store.close();}
});

test('session events after deletion create durable forget/cleanup intentions without resurrecting data',async()=> {
  const s=await setup([]),seat={path:'seatline',provider:'claude',model:null};s.engine.paths={seatline:{async run(t,r,{onEvent}) {
    await s.store.deleteDocument(s.doc.id);onEvent({type:'session',handle:'late-owned-session'});const text=jsonl(node(),end);onEvent({type:'delta',text});return {text,session:'late-owned-session',target:t};
  },async discover(){return [{provider:'claude',capabilities:{sessions:true}}];}}};
  try {await assert.rejects(s.start({target:seat,persistent:true}),/DOCUMENT_REMOVED/);assert.equal((await s.store.all('runs')).length,0);assert.equal((await s.store.all('records')).length,0);
    const rows=await s.store.all('maintenance');assert.ok(rows.some(r=>r.handle==='late-owned-session'));assert.ok(rows.some(r=>r.method==='cleanup'));
  }finally{s.store.close();}
});

test('full D request preflight measures rules/contracts/history and rejects before discovery, versions or continuation links',async()=> {
  const s=await setup([]),large=structuredClone(s.doc);large.blocks[2].text='я'.repeat(510000);let discovered=false;s.path.discover=async()=>{discovered=true;return [];};
  try {const preview=s.engine.preview({doc:large,scope:buildScope(large),target,lens:'logic'});assert.equal(preview.fits,false);await assert.rejects(s.start({doc:large,scope:buildScope(large),persistent:true}),{code:'TOO_LARGE'});assert.equal(discovered,false);assert.equal(s.path.calls.length,0);assert.equal((await s.store.all('runs')).length,0);
    const prompt=assemblePrompt(s.doc,s.scope,{lens:'logic'}),seat={path:'seatline',provider:'claude'};
    const actual=measureRequest(generationFrame(seat,prompt.request,{allowGeminiCloud:true}));assert.equal(requestPreview(seat,prompt.request).requestBytes,actual);assert.equal(scopeSize(s.doc,s.scope,{target:seat,request:prompt.request}).requestBytes,actual);
  }finally{s.store.close();}
});

test('session continuations send a compact tail and stateless overflow does not allocate an endless failed chain',async()=> {
  const s=await setup([{text:jsonl(node()),truncated:true}]);
  try {const first=await s.start({persistent:true}),records=Array.from({length:1200},(_,i)=>({sequence:i+1,record:node('h'+i,{text:'x'.repeat(1100)}),flags:[]}));
    await s.engine.repository.write(first.run.id,{},records,{replace:true});
    const continued=await s.engine.previewContinuation(first.run.id);assert.ok(continued.requestBytes<MAX_REQUEST_BYTES);assert.ok(continued.request.task.length<20000);assert.ok(!continued.request.task.includes('"id":"h0"'));
    const stateless=await s.engine.previewContinuation(first.run.id,{mode:'new'});assert.equal(stateless.fits,false);await assert.rejects(s.engine.continue(first.run.id,{mode:'new'}),{code:'TOO_LARGE'});
    assert.equal((await s.store.all('runs')).length,1);assert.equal((await s.engine.repository.get(first.run.id)).run.continuedBy,undefined);assert.equal(s.path.calls.length,1);
    const sec={sequence:1,record:{t:'sec',id:'s',title:'x',role:'claim',gist:'x',span:[1,9999],refs:Array.from({length:9999},(_,i)=>i+1)},flags:[]};
    assert.ok(continuationTask('task',[sec]).length<500);
  }finally{s.store.close();}
});

test('a path-side TOO_LARGE failure is not continuable even if it bypassed preflight',async()=> {
  const s=await setup([{text:'',error:{code:'TOO_LARGE',reason:'PATH_LIMIT_CHANGED'}}]);let id;
  try {await assert.rejects(s.start({}, {onEvent:e=>{if(e.type==='run')id=e.runId;}}),{code:'TOO_LARGE'});assert.equal((await s.engine.repository.get(id)).run.canContinue,false);await assert.rejects(s.engine.continue(id),/CONTINUATION_UNAVAILABLE/);}
  finally{s.store.close();}
});

test('record-only persistence never locks docs or rewrites the large run row',async()=> {
  const s=await setup([]),repository=new RunRepository(s.store),prompt=assemblePrompt(s.doc,s.scope,{lens:'logic'}),run=await repository.begin(s.doc,s.scope,prompt,target);
  const original=s.store.db.transaction.bind(s.store.db),transactions=[];let puts=0;
  s.store.db.transaction=(names,...args)=>{transactions.push(names);const tx=original(names,...args),objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name);if(name==='runs'){const put=store.put.bind(store);store.put=(...args)=>{puts++;return put(...args);};}return store;};return tx;};
  try {await repository.write(run.id,{},[{sequence:1,record:node(),flags:[]}]);assert.equal(puts,0);assert.deepEqual(transactions,[['runs','records']]);}
  finally{s.store.db.transaction=original;s.store.close();}
});

test('maintenance drains new and superseding intentions queued during an in-flight flush',async()=> {
  const s=await setup([]),gate=deferred(),started=deferred(),calls=[];const a={id:'cleanup:claude:doc-a',method:'cleanup',provider:'claude',group:'doc-a'};
  await s.store.put('maintenance',a);const firstRevision=(await s.store.all('maintenance'))[0].revision;
  const dispatcher=new MaintenanceDispatcher(s.store,{seatline:{async cleanup(t,g){calls.push(g);if(calls.length===1){started.resolve();await gate.promise;}},async forget(t,h){calls.push(...h);}}});
  try {const first=dispatcher.drain();await started.promise;await s.store.put('maintenance',a);await s.store.put('maintenance',{id:'forget:claude:handle-b',method:'forget',provider:'claude',handle:'handle-b'});
    assert.notEqual((await s.store.all('maintenance')).find(r=>r.id===a.id).revision,firstRevision);const again=dispatcher.drain();assert.equal(first,again);gate.resolve();const results=await again;
    assert.equal(calls.filter(x=>x==='doc-a').length,2);assert.equal(calls.filter(x=>x==='handle-b').length,1);assert.ok(results.some(r=>r.status==='superseded'));assert.equal((await s.store.all('maintenance')).length,0);
  }finally{gate.resolve();s.store.close();}
});

test('maintenance uses contract providers, discards invalid rows and survives an abort with no tx.error',async()=> {
  const s=await setup([]),calls=[];contract.providers.push('future-provider');
  try {
    await s.store.put('maintenance',{id:'a',method:'forget',provider:'future-provider',handle:'h'});await s.store.put('maintenance',{id:'b',method:'cleanup',provider:'claude',group:'g'});
    await s.store.put('maintenance',{id:'bad',method:'exec',provider:'claude',handle:'x'});
    const dispatcher=new MaintenanceDispatcher(s.store,{seatline:{async forget(t){calls.push(t.provider);},async cleanup(t){calls.push(t.provider);}}}),ack=dispatcher.acknowledge.bind(dispatcher);let abort=true;
    dispatcher.acknowledge=row=>{if(abort){abort=false;return transaction(s.store.db,'maintenance','readwrite',async tx=>{tx.abort();});}return ack(row);};
    const result=await dispatcher.drain();assert.ok(result.some(r=>r.status==='pending'));assert.ok(result.some(r=>r.status==='completed'));assert.ok(result.some(r=>r.status==='discarded'));
    assert.deepEqual(calls,['future-provider','claude']);assert.equal((await s.store.all('maintenance')).length,1);await dispatcher.drain();assert.equal((await s.store.all('maintenance')).length,0);
  }finally{contract.providers.pop();s.store.close();}
});
