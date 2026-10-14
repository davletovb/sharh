import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore} from '../src/documents/store.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {versionOf} from '../src/documents/model.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {RunRepository} from '../src/analysis/storage.mjs';
import {MaintenanceDispatcher} from '../src/analysis/maintenance.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {exampleDocument} from './helpers/document.mjs';
const target={path:'fake',provider:'fixture',model:'scripted'};
const row=(id='p1',extra={})=>({t:'node',id,kind:'claim',text:'A scripted finding',refs:[3],basis:'stated',...extra});
const jsonl=(...rows)=>rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n';
const good=jsonl(row(),{t:'end'}),instant=async()=>{};
async function setup(scripts,options={}) {
  const store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
  const path=new FakePath({scripts,wait:instant,...options});
  const engine=new AnalysisEngine({store,paths:{fake:path}}),scope=buildScope(doc);
  return {store,doc,path,engine,scope,start:(extra={},events={})=>engine.start({doc,scope,target,lens:'logic',...extra},events)};
}

test('engine streams recorded fixtures, persists validated records, target, prompt version, metrics and distinct lens versions',async()=> {
  const recorded=await readFile('tests/fixtures/analysis/logic.jsonl','utf8'),s=await setup([{text:recorded,usage:{input_tokens:10,output_tokens:4}},{text:recorded}]);
  try {
    let firstBeforeEnd=false,ended=false;
    const one=await s.start({}, {onEvent:e=>{if(e.type==='record' && !ended)firstBeforeEnd=true;if(e.type==='completed')ended=true;}});
    assert.ok(firstBeforeEnd);assert.equal(one.run.status,'completed');assert.equal(one.run.promptVersion,'analysis-1');assert.equal(one.records.length,3);
    assert.deepEqual(one.run.target,target);assert.equal(one.run.metrics.quotationsVerified,1);assert.equal(one.run.metrics.truncated,false);assert.deepEqual(one.run.metrics.usage,{input_tokens:10,output_tokens:4});
    assert.ok(one.run.metrics.timeToFirstRecordMs>=0);assert.ok(one.run.metrics.totalMs>=one.run.metrics.timeToFirstRecordMs);
    const two=await s.start();assert.notEqual(one.run.id,two.run.id);assert.equal(two.run.version,2);assert.equal((await s.engine.repository.list(s.doc.id)).length,2);
    const changed=structuredClone(s.doc);changed.version=await versionOf(changed.identity,'changed');await s.store.saveDocument(changed);
    assert.ok((await s.engine.repository.list(s.doc.id)).every(r=>r.stale));
    const clone=await openDocumentStore({indexedDB:new IDBFactory()});try {await clone.importData(await s.store.exportData());assert.equal((await clone.all('runs')).length,2);assert.equal((await clone.all('records')).length,6);}finally{clone.close();}
  }finally{s.store.close();}
});

test('exactly one repair receives faulty output and contract, never source document, and replaces the visible attempt',async()=> {
  const broken=await readFile('tests/fixtures/analysis/malformed.jsonl','utf8'),s=await setup([{text:broken,usage:{input_tokens:10}},{text:good,usage:{input_tokens:3}}]);
  try {
    const events=[],r=await s.start({}, {onEvent:e=>events.push(e)});
    assert.equal(s.path.calls.length,2);assert.equal(s.path.calls[1].request.kind,'repair');assert.equal(s.path.calls[1].request.document,null);
    assert.ok(!s.path.calls[1].request.task.includes('Selected public evidence.'));assert.match(s.path.calls[1].request.task,/SHARH_OUTPUT_CONTRACT/);
    assert.equal(r.run.attempts.length,2);assert.equal(r.run.status,'completed');assert.equal(r.records.length,1);assert.equal(r.records[0].record.text,'A scripted finding');
    assert.equal(r.run.metrics.usage.input_tokens,13);assert.equal(events.filter(e=>e.type==='repairing').length,1);assert.equal(events.filter(e=>e.type==='reset').length,1);
    assert.equal(events.filter(e=>e.type==='record').length,2);
  }finally{s.store.close();}
  const bad=await setup([{text:'{broken}\n'},{text:'{still broken}\n'}]);
  try {const r=await bad.start();assert.equal(bad.path.calls.length,2);assert.equal(r.run.status,'truncated');assert.equal(r.run.metrics.validRecords,0);assert.equal(r.run.attempts.length,2);}finally{bad.store.close();}
});

test('repair threshold excludes meta/end and triggers below 80 percent, not at the boundary',async()=> {
  const rows=Array.from({length:4},(_,i)=>row('n'+i));
  const exact=await setup([{text:jsonl({t:'meta',lens:'logic',lang:'en'},...rows,'{bad}',{t:'end'})}]);
  try {const r=await exact.start();assert.equal(exact.path.calls.length,1);assert.equal(r.run.metrics.validRate,0.8);}finally{exact.store.close();}
  const below=await setup([{text:jsonl(...rows,'{bad}','{bad}',{t:'end'})},{text:good}]);
  try {await below.start();assert.equal(below.path.calls.length,2);}finally{below.store.close();}
});

test('failed repair retains the original validated records and records the failed attempt',async()=> {
  const s=await setup([{text:jsonl(row(),'{bad}','{bad}',{t:'end'})},{text:jsonl(row('should-not-leak')),error:{code:'DISCONNECTED',reason:'PORT_DISCONNECTED'}}]);
  try {const events=[],r=await s.start({}, {onEvent:e=>events.push(e)});assert.equal(r.records.length,1);assert.equal(r.records[0].record.id,'p1');assert.equal(r.run.attempts[1].error.code,'DISCONNECTED');assert.ok(events.some(e=>e.type==='repair_failed'));assert.ok(!events.some(e=>e.entry?.record.id==='should-not-leak'));}finally{s.store.close();}
});

test('explicit continuation reuses a supported session, resends neither rules nor document and creates a linked version',async()=> {
  const s=await setup([{text:jsonl(row()),truncated:true},{text:jsonl({t:'edge',from:'p1',to:'p2',rel:'supports'},row('p2'),{t:'end'})}]);
  try {
    const first=await s.start({persistent:true});assert.equal(first.run.status,'truncated');assert.ok(first.run.session.handle);
    const next=await s.engine.continue(first.run.id);assert.equal(next.run.previousId,first.run.id);assert.equal(next.run.version,2);assert.equal(next.records.length,3);assert.equal(next.run.status,'completed');
    assert.equal(s.path.calls[1].request.session.mode,'continue');assert.equal(s.path.calls[1].request.document,null);
    assert.equal(next.run.metrics.retainedRecords,1);assert.equal(next.run.metrics.newValidRecords,2);assert.equal(next.run.metrics.validRate,1);
    assert.equal((await s.engine.repository.get(first.run.id)).run.continuedBy,next.run.id);
    await assert.rejects(s.engine.continue(first.run.id),/CONTINUATION_UNAVAILABLE/);
  }finally{s.store.close();}
});

test('sessionless and explicitly new continuations resend scope and preserve partial records/flags',async()=> {
  for(const options of [{sessions:false},{sessions:true,mode:'new'}]) {
    const s=await setup([{text:jsonl(row('p1',{quote:'not in source'})),truncated:true},{text:jsonl(row('p2'),{t:'end'})}],{sessions:options.sessions});
    try {
      const first=await s.start({persistent:true});const next=await s.engine.continue(first.run.id,{mode:options.mode??'auto'});
      assert.equal(s.path.calls[1].request.session.mode,'none');assert.ok(s.path.calls[1].request.document.includes('First paragraph'));assert.equal(next.records.length,2);
      assert.ok(next.records[0].flags.includes('quotation_not_found'));assert.equal(next.run.metrics.quotationsFailed,0);
    }finally{s.store.close();}
  }
});

test('lost session refuses a contextless answer and explicit continuation can resend the document',async()=> {
  const s=await setup([{text:jsonl(row()),truncated:true},{text:jsonl(row('untrusted'),{t:'end'}),sessionLost:true},{text:jsonl(row('p2'),{t:'end'})}]);
  try {
    const first=await s.start({persistent:true});let failedId;
    await assert.rejects(s.engine.continue(first.run.id),e=>{failedId=e.runId;return e.reason==='UNKNOWN_SESSION';});
    const failed=await s.engine.repository.get(failedId);assert.equal(failed.records.length,1);assert.equal(failed.run.session.reusable,false);assert.equal(failed.records[0].record.id,'p1');
    const next=await s.engine.continue(failedId,{mode:'new'});assert.equal(next.run.status,'completed');assert.equal(next.records.length,2);assert.ok(s.path.calls[2].request.document);
  }finally{s.store.close();}
});

test('UNKNOWN_SESSION before output restarts once with scope and tells the observer',async()=> {
  const s=await setup([{text:jsonl(row()),truncated:true},{text:jsonl(row('p2'),{t:'end'})}]);
  try {const first=await s.start({persistent:true});s.path.handles.clear();const events=[];const next=await s.engine.continue(first.run.id,{onEvent:e=>events.push(e)});assert.equal(next.run.status,'completed');assert.ok(events.some(e=>e.type==='session_reset'));assert.equal(s.path.calls.length,3);assert.equal(s.path.calls[2].request.session.mode,'start');assert.ok(s.path.calls[2].request.document);}finally{s.store.close();}
});

test('cancelled turns keep partial records and do not trigger a repair or automatic replay',async()=> {
  const s=await setup([{chunks:[jsonl(row()),jsonl(row('p2'),{t:'end'})]}]);
  try {const abort=new AbortController();let id;await assert.rejects(s.start({}, {signal:abort.signal,onEvent:e=>{if(e.type==='run')id=e.runId;if(e.type==='record')abort.abort();}}),{code:'CANCELLED'});const saved=await s.engine.repository.get(id);assert.equal(saved.run.status,'cancelled');assert.equal(saved.run.canContinue,true);assert.equal(saved.records.length,1);assert.equal(s.path.calls.length,1);}finally{s.store.close();}
});

test('deletion during streaming never recreates a run or records',async()=> {
  const s=await setup([{chunks:[jsonl(row()),jsonl(row('p2'),{t:'end'})]}]);let waits=0;
  s.path.wait=async()=>{if(++waits===2)await s.store.deleteDocument(s.doc.id);};
  try {await assert.rejects(s.start(),/DOCUMENT_REMOVED/);assert.equal((await s.store.all('runs')).length,0);assert.equal((await s.store.all('records')).length,0);assert.equal(await s.store.getDocument(s.doc.id),null);}finally{s.store.close();}
});

test('concurrent versions allocate atomically, stale scopes refuse new runs and archived extraction continuation stays stale',async()=> {
  const s=await setup([{text:good},{text:good},{text:jsonl(row()),truncated:true},{text:jsonl(row('p2'),{t:'end'})}]);
  try {
    const both=await Promise.all([s.start(),s.start()]);assert.deepEqual(both.map(r=>r.run.version).sort(),[1,2]);
    const partial=await s.start();const changed={...s.doc,version:await versionOf(s.doc.identity,'new')};await s.store.saveDocument(changed);
    await assert.rejects(s.start(),/STALE_SCOPE/);const continued=await s.engine.continue(partial.run.id,{mode:'new'});assert.equal(continued.run.stale,true);assert.equal(continued.run.extractionVersion,s.doc.version);
  }finally{s.store.close();}
});

test('durable maintenance drains through path APIs, preserves failures and deduplicates simultaneous drains',async()=> {
  const s=await setup([]);let failures=1,calls=0;
  try {
    await s.store.put('runs',{id:'owned',docId:s.doc.id,target:{path:'seatline',provider:'codex'},session:{handle:'owned-session'},cleanupGroup:'doc-owned'});await s.store.deleteDocument(s.doc.id);
    const path={async forget(){calls++;if(failures--)throw Object.assign(Error('offline'),{code:'DISCONNECTED'});},async cleanup(){calls++;}};
    const dispatcher=new MaintenanceDispatcher(s.store,{seatline:path});
    const a=dispatcher.drain(),b=dispatcher.drain();assert.equal(a,b);await a;assert.equal((await s.store.all('maintenance')).length,0);
    await dispatcher.drain();assert.equal((await s.store.all('maintenance')).length,0);assert.equal(calls,3);
  }finally{s.store.close();}
});

test('fake path exposes timing, nonstreaming-sized chunks, cancellation and UTF-8 output caps honestly',async()=> {
  const waits=[],path=new FakePath({scripts:[{chunks:[{text:'🙂'.repeat(3),delayMs:15}]}],wait:async ms=>waits.push(ms)});
  const result=await path.run(target,{kind:'analysis',task:'x',session:{mode:'none'},limits:{maxOutputBytes:5}},{onEvent:()=>{}});
  assert.deepEqual(waits,[15]);assert.equal(result.text,'🙂');assert.equal(result.truncated,true);assert.equal(result.session,null);assert.equal((await path.discover())[0].capabilities.sessions,true);
  const abort=new AbortController();abort.abort();await assert.rejects(path.run(target,{},{signal:abort.signal}),{code:'CANCELLED'});
});

test('successful format repair cannot erase a path-reported output truncation or its continue action',async()=> {
  const s=await setup([{text:'{broken fragment',truncated:true},{text:good}]);
  try {const result=await s.start();assert.equal(result.run.status,'truncated');assert.equal(result.run.canContinue,true);assert.equal(result.run.metrics.truncated,true);assert.equal(result.run.attempts[1].metrics.truncated,false);assert.equal(result.records.length,1);assert.equal(s.path.calls.length,2);}finally{s.store.close();}
});

test('transport-successful but empty or mostly malformed repairs never replace useful validated records',async()=> {
  for(const repair of [jsonl({t:'end'}),jsonl(row('replacement'),'{bad}','{bad}',{t:'end'})]) {
    const s=await setup([{text:jsonl(row('useful'),'{bad}','{bad}',{t:'end'})},{text:repair}]);
    try {
      const events=[],result=await s.start({}, {onEvent:e=>events.push(e)});
      assert.equal(result.records.length,1);assert.equal(result.records[0].record.id,'useful');assert.equal(result.run.attempts[1].accepted,false);
      assert.equal(s.path.calls.length,2);assert.ok(events.some(e=>e.type==='repair_failed' && ['INVALID_OUTPUT','FEWER_VALID_RECORDS'].includes(e.code)));assert.ok(!events.some(e=>e.type==='reset'));
      assert.ok(!events.some(e=>e.entry?.record.id==='replacement'));
    }finally{s.store.close();}
  }
});

test('continuation repair seeds immutable history locally, preserving more history than the repair output cap',async()=> {
  const history=Array.from({length:80},(_,i)=>row('old'+i,{text:`IMMUTABLE_HISTORY_${i} `+'x'.repeat(600)}));
  assert.ok(Buffer.byteLength(jsonl(...history))>32768);
  const s=await setup([{text:jsonl(...history),truncated:true},{text:jsonl(row('new-partial'),'{bad}','{bad}',{t:'end'})},
    {text:jsonl({t:'edge',from:'old0',to:'corrected',rel:'supports'},row('corrected'),{t:'end'})}]);
  try {
    const first=await s.start(),result=await s.engine.continue(first.run.id,{mode:'new'});
    assert.equal(result.run.status,'completed');assert.equal(result.records.length,82);assert.equal(result.run.metrics.retainedRecords,80);assert.equal(result.run.metrics.newValidRecords,2);
    assert.equal(result.run.metrics.validRate,1);assert.equal(result.run.attempts[1].accepted,true);assert.equal(s.path.calls[2].request.document,null);
    assert.ok(!s.path.calls[2].request.task.includes('IMMUTABLE_HISTORY_'));assert.ok(s.path.calls[2].request.task.includes('new-partial'));
    assert.deepEqual(result.records.slice(0,80).map(e=>e.record),first.records.map(e=>e.record));assert.equal(result.records.some(e=>e.record.id==='new-partial'),false);
  }finally{s.store.close();}
});
