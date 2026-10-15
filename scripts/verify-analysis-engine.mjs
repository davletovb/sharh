// D production engine + UI RPC + pinned real broker. Provider CLIs are deterministic stand-ins.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdtemp,mkdir,cp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {browserOptions} from './lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../tests/helpers/browser-api-loader.mjs';
const {values}=parseArgs({options:{companion:{type:'string'},'fake-provider':{type:'string'}}});
if(!values.companion || !values['fake-provider'])throw Error('Use --companion PATH --fake-provider PATH');
const world=await isolatedCompanion(resolve(values.companion),resolve(values['fake-provider']));
const profile=await mkdtemp(join(tmpdir(),'sharh-d-companion-')),report={kind:'production-analysis-engine-real-broker-stand-ins',liveProviderClaim:false,revision:world.contract.revision,checks:{}};
let context;
try {
  await mkdir(join(profile,'NativeMessagingHosts'),{recursive:true});
  await cp(join(world.env.XDG_CONFIG_HOME,'google-chrome/NativeMessagingHosts/com.seatline.host.json'),join(profile,'NativeMessagingHosts/com.seatline.host.json'));
  const extension=resolve('dist/sharh');
  context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',env:world.env,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});await context.addInitScript(()=>{try{localStorage.setItem('sharh:layout','studio');}catch{/* The tests drive every control. */}});
  const page=await context.newPage();await page.goto(`${world.origin}ui/reader.html`);await page.locator('.workspace-nav').waitFor();await installBrowserTestAPI(page);
  const result=await page.evaluate(async()=> {
    const {openDocumentStore,exampleDocument,buildScope,createAnalysisEngine}=SharhTest;
    const store=await openDocumentStore({name:'d-real-broker'}),doc=await exampleDocument();await store.saveDocument(doc);
    const {engine,maintenance}=createAnalysisEngine(store),events=[];
    try {
      const first=await engine.start({doc,scope:buildScope(doc),target:{path:'seatline',provider:'claude',model:null},lens:'logic',focus:'fixture:truncate',persistent:true},{onEvent:e=>events.push(e.type)});
      const next=await engine.continue(first.run.id,{onEvent:e=>events.push(e.type)});
      const metadata={first:{status:first.run.status,records:first.records.length,session:!!first.run.session,metrics:first.run.metrics},next:{status:next.run.status,records:next.records.length,version:next.run.version,previousId:next.run.previousId===first.run.id,metrics:next.run.metrics},events};
      await store.deleteDocument(doc.id);const queued=(await store.all('maintenance')).length,drained=await maintenance.drain();
      return {...metadata,queued,drained:drained.map(r=>r.status),remaining:(await store.all('maintenance')).length,runs:(await store.all('runs')).length,records:(await store.all('records')).length};
    }finally{store.close();}
  });
  assert.equal(result.first.status,'truncated');assert.equal(result.first.records,4);assert.ok(result.first.session);assert.equal(result.first.metrics.validRate,1);
  assert.equal(result.next.status,'completed');assert.equal(result.next.records,6);assert.equal(result.next.version,2);assert.ok(result.next.previousId);assert.equal(result.next.metrics.retainedRecords,4);
  assert.ok(result.events.includes('delta'));assert.ok(result.events.includes('record'));assert.ok(result.events.includes('session'));
  assert.equal(result.queued,2);assert.deepEqual(result.drained,['completed','completed']);assert.equal(result.remaining,0);assert.equal(result.runs,0);assert.equal(result.records,0);
  report.checks.productionEngineStreaming=true;report.checks.validatedPersistentContinuation=true;report.checks.storedVersionsAndMetrics=true;report.checks.realForgetCleanupAndCascade=true;report.result=result;
  // Close a caller before it can save its session. The worker must own that journal,
  // independently of the engine page and its lifetime.
  const owner=await context.newPage();await owner.goto(`${world.origin}ui/reader.html`);await installBrowserTestAPI(owner);
  let sessionReady;const sessionSeen=new Promise(resolve=>{sessionReady=resolve;});
  await owner.exposeFunction('reportSession',()=>sessionReady());
  const orphan=await owner.evaluate(async()=> {
    const {openDocumentStore,exampleDocument,buildScope,createAnalysisEngine}=SharhTest,store=await openDocumentStore({name:'d-orphan-broker'}),doc=await exampleDocument('https://example.org/orphan');
    await store.saveDocument(doc);const {engine}=createAnalysisEngine(store);await engine.ready;
    const target={path:'seatline',provider:'claude',model:null},prompt=engine.preview({doc,scope:buildScope(doc),target,lens:'logic',focus:'fixture:pause',persistent:true});
    const run=await engine.repository.begin(doc,buildScope(doc),prompt,target),{PathClient}=await import('./client.mjs'),client=new PathClient();
    window.orphanWork=client.call('run',{target,request:prompt.request,analysisRunId:run.id,analysisDatabase:store.db.name},{onEvent:event=>{if(event.type==='session')window.reportSession();}}).catch(()=>{});
    return {id:run.id,docId:doc.id};
  });
  let timer;
  try {await Promise.race([sessionSeen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SESSION_TIMEOUT')),15000);})]);}finally{clearTimeout(timer);}
  await owner.close();
  const journal=await page.evaluate(async orphan=> {
    const {openDocumentStore,createAnalysisEngine}=SharhTest,store=await openDocumentStore({name:'d-orphan-broker'});
    try {
      const {engine,maintenance}=createAnalysisEngine(store);await engine.ready;
      const saved=await engine.repository.get(orphan.id),owned=saved.run.sessionHandles?.length??0;
      await store.deleteDocument(orphan.docId);const rows=await store.all('maintenance'),drained=await maintenance.drain();
      return {owned,queued:rows.length,forget:rows.some(r=>r.method==='forget'),status:saved.run.status,remaining:(await store.all('maintenance')).length,drained:drained.every(r=>r.status==='completed')};
    }finally{store.close();}
  },orphan);
  assert.equal(journal.owned,1);assert.equal(journal.status,'interrupted');assert.equal(journal.queued,2);assert.ok(journal.forget && journal.drained);assert.equal(journal.remaining,0);
  report.checks.workerJournalsSessionAfterPageCloses=true;report.orphanJournal=journal;
  // E uses the same engine through its actual packaged controls and worker RPC.
  await page.locator('#open-file').setInputFiles('corpus/fixtures/html/article-en.html');
  await page.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
  await page.locator('.lens-bar').getByRole('button',{name:'Logic',exact:true}).click();
  await page.locator('.adjust summary').click();
  await page.locator('.analysis-controls').getByLabel('Focus (optional)',{exact:true}).fill('fixture:truncate');
  await page.locator('.analysis-controls').getByRole('button',{name:'Analyze',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.run-state').textContent.startsWith('Partial result saved'));
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.run-state').textContent.startsWith('Completed'));
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-results .finding').length===6 && !document.querySelector('.run-history').inert);
  await page.locator('.analysis-results .reference').first().click();
  await page.waitForFunction(()=>document.querySelector('.block.selected'));
  const savedIds=await page.locator('.run-history select').first().locator('option').evaluateAll(rows=>rows.map(r=>r.value).filter(Boolean));
  assert.equal(savedIds.length,2);await page.screenshot({path:'test-results/e-real-workspace.png',fullPage:true});
  await page.reload();await page.locator('#saved-documents article').filter({hasText:'article-en.html'}).getByRole('button',{name:'Open',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-results .finding').length===6);
  const restoredIds=await page.locator('.run-history select').first().locator('option').evaluateAll(rows=>rows.map(r=>r.value).filter(Boolean));
  assert.deepEqual(restoredIds,savedIds);
  await page.locator('.workspace-nav').getByRole('button',{name:'History',exact:true}).click();
  await page.locator('.run-history select').nth(1).selectOption(savedIds[1]);await page.getByRole('button',{name:'Compare versions',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.compare-columns>section').length===2);
  report.checks.packagedWorkspaceAnalyzeContinueReloadCompare=true;report.passed=true;
}catch(error){report.passed=false;report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally {await context?.close();await world.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/d-companion.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,report:'test-results/d-companion.json',failure:report.failure?.message}));
