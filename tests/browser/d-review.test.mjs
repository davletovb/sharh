import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const base='chrome-extension://npmhefooiolfpmhicinblelaideeejcm';

test('D review: browser locks preserve live owners and recover a closed continuation page with its persisted history',async()=> {
  const profile=await mkdtemp(join(tmpdir(),'sharh-d-owner-')),report={checks:{},errors:[]};let context;
  try {
    const extension=resolve('dist/sharh');
    context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});await context.addInitScript(()=>{try{localStorage.setItem('sharh:layout','studio');}catch{/* The tests drive every control. */}});
    const owner=await context.newPage();owner.on('pageerror',e=>report.errors.push(e.message));await owner.goto(base+'/ui/reader.html');await installBrowserTestAPI(owner);
    const ids=await owner.evaluate(async()=> {
      const {openDocumentStore,exampleDocument,buildScope,AnalysisEngine,FakePath}=SharhTest;
      const store=await openDocumentStore({name:'d-owner-review'}),doc=await exampleDocument();await store.saveDocument(doc);
      const row=id=>JSON.stringify({t:'node',id,kind:'claim',text:'Stored '+id,refs:[3],basis:'stated'})+'\n';
      const path=new FakePath({scripts:[{chunks:[row('a')],truncated:true},{chunks:[row('b'),'{"t":"end"}\n']}],wait:async()=>{}});
      const engine=new AnalysisEngine({store,paths:{fake:path}}),first=await engine.start({doc,scope:buildScope(doc),target:{path:'fake',provider:'fixture'},lens:'logic'});
      let waits=0;
      path.wait=async(ms,signal)=>{if(++waits===2)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
      window.ownerRun={store,engine,first:first.run.id,child:null};
      window.ownerRun.work=engine.continue(first.run.id,{onEvent:e=>{if(e.type==='run' && e.status==='running')window.ownerRun.child=e.runId;}}).catch(()=>{});
      return {first:first.run.id};
    });
    await owner.waitForFunction(async()=>ownerRun.child && (await ownerRun.store.all('records')).some(e=>e.runId===ownerRun.child && e.record.id==='b'));
    ids.child=await owner.evaluate(()=>ownerRun.child);
    const observer=await context.newPage();observer.on('pageerror',e=>report.errors.push(e.message));await observer.goto(base+'/ui/reader.html');await installBrowserTestAPI(observer);
    const live=await observer.evaluate(async ids=> {
      const {openDocumentStore,AnalysisEngine,FakePath}=SharhTest,store=await openDocumentStore({name:'d-owner-review'});
      const path=new FakePath({scripts:[{text:'{"t":"node","id":"c","kind":"claim","text":"Recovered","refs":[3],"basis":"stated"}\n{"t":"end"}\n'}],wait:async()=>{}});
      const engine=new AnalysisEngine({store,paths:{fake:path}});await engine.ready;window.observerRun={store,engine};
      let refusal;try{await engine.continue(ids.child);}catch(error){refusal=error.message;}
      return {status:(await engine.repository.get(ids.child)).run.status,refusal};
    },ids);
    assert.deepEqual(live,{status:'running',refusal:'CONTINUATION_UNAVAILABLE'});report.checks.liveOwnerProtected=true;
    await owner.close();
    const recovered=await observer.evaluate(async ids=> {
      const {engine}=observerRun;await engine.recover();const interrupted=await engine.repository.get(ids.child),next=await engine.continue(ids.child);
      return {interrupted:interrupted.run.status,retained:interrupted.records.map(e=>e.record.id),status:next.run.status,version:next.run.version,
        records:next.records.map(e=>e.record.id),parent:next.run.previousId,firstChild:(await engine.repository.get(ids.first)).run.continuedBy};
    },ids);
    assert.equal(recovered.interrupted,'interrupted');assert.deepEqual(recovered.retained,['a','b']);assert.equal(recovered.status,'completed');assert.equal(recovered.version,3);
    assert.deepEqual(recovered.records,['a','b','c']);assert.equal(recovered.parent,ids.child);assert.equal(recovered.firstChild,ids.child);report.checks.closedOwnerRecovered=recovered;
    assert.deepEqual(report.errors,[]);report.passed=true;
  }finally {
    await context?.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/d-review.json',JSON.stringify(report,null,2)+'\n');
  }
});
