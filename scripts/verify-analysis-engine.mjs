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
  context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',env:world.env,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
  const page=await context.newPage();await page.goto(`${world.origin}ui/reader.html`);await installBrowserTestAPI(page);
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
  report.checks.productionEngineStreaming=true;report.checks.validatedPersistentContinuation=true;report.checks.storedVersionsAndMetrics=true;report.checks.realForgetCleanupAndCascade=true;report.result=result;report.passed=true;
}catch(error){report.passed=false;report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally {await context?.close();await world.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/d-companion.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,report:'test-results/d-companion.json',failure:report.failure?.message}));
