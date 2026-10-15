import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const base='chrome-extension://npmhefooiolfpmhicinblelaideeejcm';

test('D engine in packaged Chromium: timed streaming text view, repair, continuation, IndexedDB reload and safe model text',async()=> {
  const profile=await mkdtemp(join(tmpdir(),'sharh-d-engine-')),report={checks:{},errors:[]};let context;
  try {
    const extension=resolve('dist/sharh');
    context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});await context.addInitScript(()=>{try{localStorage.setItem('sharh:layout','studio');}catch{/* The tests drive every control. */}});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(`${base}/ui/reader.html`);await installBrowserTestAPI(page);
    await page.evaluate(async()=> {
      const {openDocumentStore,exampleDocument,buildScope,AnalysisEngine,FakePath,createRecordSink}=SharhTest;
      const store=await openDocumentStore({name:'d-browser'}),doc=await exampleDocument();await store.saveDocument(doc);
      const container=document.createElement('section');container.id='analysis-fixture';document.body.append(container);const sink=createRecordSink(container);
      const chunks=Array.from({length:200},(_,i)=>({delayMs:2,text:JSON.stringify({t:'note',text:`Record ${i} <svg onload=alert(1)>`,refs:[3]})+'\n'})).concat({text:'{"t":"end"}\n',delayMs:2});
      const path=new FakePath({scripts:[{chunks}]}),engine=new AnalysisEngine({store,paths:{fake:path}});
      window.d={store,doc,path,engine,container,sink,finished:false,maxRenderMs:0,firstRecordBeforeEnd:false};
      window.d.promise=engine.start({doc,scope:buildScope(doc),lens:'summary',target:{path:'fake',provider:'fixture'},budget:200},{onEvent:e=> {
        const start=performance.now();if(e.type==='record'){sink.record(e.entry);window.d.firstRecordBeforeEnd=true;}if(e.type==='reset')sink.reset();window.d.maxRenderMs=Math.max(window.d.maxRenderMs,performance.now()-start);
      }}).then(result=>{window.d.result=result;window.d.finished=true;});
    });
    await page.waitForFunction(()=>document.querySelectorAll('#analysis-fixture article').length>0 && !window.d.finished);
    await page.evaluate(()=>window.d.promise);assert.equal(await page.locator('#analysis-fixture article').count(),200);assert.equal(await page.locator('#analysis-fixture svg').count(),0);
    assert.match(await page.locator('#analysis-fixture').textContent(),/<svg/);
    const streaming=await page.evaluate(()=>({status:d.result.run.status,maxRenderMs:d.maxRenderMs,firstBeforeEnd:d.firstRecordBeforeEnd,id:d.result.run.id,metrics:d.result.run.metrics}));
    assert.equal(streaming.status,'completed');assert.ok(streaming.firstBeforeEnd);assert.ok(streaming.maxRenderMs<100);report.checks.streaming200TextRecords=streaming;
    await page.screenshot({path:'test-results/d-records.png'});
    const malformed=await readFile('tests/fixtures/analysis/malformed.jsonl','utf8'),good=await readFile('tests/fixtures/analysis/logic.jsonl','utf8');
    const repaired=await page.evaluate(async({malformed,good})=> {
      const {FakePath,AnalysisEngine,buildScope}=SharhTest,path=new FakePath({scripts:[{text:malformed},{text:good}],delayMs:1}),engine=new AnalysisEngine({store:d.store,paths:{fake:path}});
      d.sink.reset();const result=await engine.start({doc:d.doc,scope:buildScope(d.doc),lens:'logic',target:{path:'fake',provider:'fixture'}},{onEvent:e=>{if(e.type==='record')d.sink.record(e.entry);if(e.type==='reset')d.sink.reset();}});
      return {status:result.run.status,attempts:result.run.attempts.length,records:result.records.length,calls:path.calls.map(c=>({kind:c.request.kind,hasDocument:c.request.document!==null}))};
    },{malformed,good});
    assert.deepEqual(repaired,{status:'completed',attempts:2,records:3,calls:[{kind:'analysis',hasDocument:true},{kind:'repair',hasDocument:false}]});report.checks.repair=repaired;
    assert.equal(await page.locator('#analysis-fixture article').count(),3);assert.equal(await page.locator('#analysis-fixture img').count(),0);
    const continuation=await page.evaluate(async()=> {
      const {FakePath,AnalysisEngine,buildScope}=SharhTest;
      const path=new FakePath({sessions:false,delayMs:1,scripts:[{text:'{"t":"note","text":"Kept partial","refs":[3]}\n',truncated:true},
        {text:'{"t":"note","text":"Next part","refs":[4]}\n{broken}\n{broken}\n{"t":"end"}\n'},
        {text:'{"t":"note","text":"Next part","refs":[4]}\n{"t":"end"}\n'}]});
      const engine=new AnalysisEngine({store:d.store,paths:{fake:path}}),first=await engine.start({doc:d.doc,scope:buildScope(d.doc),lens:'summary',target:{path:'fake',provider:'fixture'}});
      const next=await engine.continue(first.run.id);return {id:next.run.id,previousId:next.run.previousId,status:next.run.status,records:next.records.length,hasDocument:!!path.calls[1].request.document,
        repairAttempts:next.run.attempts.length,repairExcludedHistory:!path.calls[2].request.task.includes('Kept partial')};
    });
    assert.equal(continuation.status,'completed');assert.equal(continuation.records,2);assert.ok(continuation.hasDocument);assert.equal(continuation.repairAttempts,2);assert.ok(continuation.repairExcludedHistory);report.checks.continuation=continuation;
    await page.reload();await installBrowserTestAPI(page);
    const persisted=await page.evaluate(async id=>{const store=await SharhTest.openDocumentStore({name:'d-browser'});try{return await new SharhTest.RunRepository(store).get(id);}finally{store.close();}},continuation.id);
    assert.equal(persisted.records.length,2);assert.equal(persisted.run.previousId,continuation.previousId);report.checks.reload=true;
    assert.deepEqual(report.errors,[]);report.passed=true;
  }finally {
    await context?.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/d-engine.json',JSON.stringify(report,null,2)+'\n');
  }
});
