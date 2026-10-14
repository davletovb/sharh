import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile,cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {nativePort} from './lib/native-stdio.mjs';
import {probeClient,probeStatuses} from './lib/probe-client.mjs';
import {fixtureBrowser,browserOptions} from './lib/browser-fixtures.mjs';
import {runOutputProbe,reportPasses} from './lib/run-output-probe.mjs';
const {values}=parseArgs({options:{companion:{type:'string'},'fake-provider':{type:'string'},out:{type:'string',default:'test-results/companion.json'}}});
if (!values.companion || !values['fake-provider']) throw new Error('Use --companion PATH --fake-provider PATH');
const world=await isolatedCompanion(resolve(values.companion),resolve(values['fake-provider']));
let client,browser,context; const profile=await mkdtemp(join(tmpdir(),'sharh-chrome-'));
const report={kind:'seatline-stand-in',liveProviderClaim:false,seatlineRevision:world.contract.revision,extensionId:world.contract.development_extension_id};
try {
  client=probeClient(nativePort(world.installed,world.origin,world.env));
  report.ready=await client.ready; assert.equal(report.ready.version,1);
  report.providers=await probeStatuses(client,world.contract.providers);
  assert.equal(report.providers.length,4); assert.ok(report.providers.every(p=>p.status),JSON.stringify(report.providers));
  const unauthorized=probeClient(nativePort(world.installed,'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',world.env));
  await assert.rejects(unauthorized.ready,/DISCONNECTED/); unauthorized.close(); report.wrongOriginRejected=true;
  browser=await fixtureBrowser();
  const corpus=JSON.parse(await readFile('corpus/manifest.json'));
  report.output=await runOutputProbe({client,items:corpus.items,providers:['claude','codex'],extract:browser.extract,contract:world.contract});
  report.output.kind='seatline-stand-in'; report.output.liveProviderClaim=false;
  assert.ok(reportPasses(report.output),'Stand-in output contract probe failed');
  await browser.close(); browser=null; client.close(); client=null;
  // Chrome native registration is under an isolated XDG config. No owner's grants are changed.
  // Chromium uses its own native-host directory; mirror the installer registration only in this test profile.
  const chromeManifest=join(world.env.XDG_CONFIG_HOME,'google-chrome/NativeMessagingHosts/com.seatline.host.json');
  for (const dir of ['chromium/NativeMessagingHosts','google-chrome-for-testing/NativeMessagingHosts']) {
    await mkdir(join(world.env.XDG_CONFIG_HOME,dir),{recursive:true}); await cp(chromeManifest,join(world.env.XDG_CONFIG_HOME,dir,'com.seatline.host.json'));
  }
  const extension=resolve('dist/probe');
  context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',env:{...process.env,...world.env},args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const page=await context.newPage();
  await page.goto(`chrome-extension://${world.contract.development_extension_id}/probe.html`);
  await page.waitForFunction(()=>typeof window.checkAuthorization==='function');
  report.chromeReady=await page.evaluate(()=>window.checkAuthorization());
  assert.ok(report.chromeReady.ready,JSON.stringify(report.chromeReady));
  assert.ok(report.chromeReady.providers.every(p=>p.status));
  report.missingHost=await page.evaluate(()=>window.checkAuthorization('com.sharh.missing'));
  assert.match(report.missingHost.error,/not found/i);
  // Remove the allowed origin from Chrome's host manifest and reload a fresh native port.
  const denied=JSON.parse(await readFile(chromeManifest)); denied.allowed_origins=[];
  for (const dir of ['google-chrome','chromium','google-chrome-for-testing']) await writeFile(join(world.env.XDG_CONFIG_HOME,dir,'NativeMessagingHosts/com.seatline.host.json'),JSON.stringify(denied));
  report.forbiddenOrigin=await page.evaluate(()=>window.checkAuthorization());
  assert.match(report.forbiddenOrigin.error,/forbidden/i);
  report.passed=true;
} catch(error) { report.passed=false; report.failure=error.message; process.exitCode=1; }
finally {
  client?.close(); await browser?.close(); await context?.close(); await world.close(); await rm(profile,{recursive:true,force:true});
  await mkdir(dirname(values.out),{recursive:true}); await writeFile(values.out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,report:values.out,failure:report.failure}));
}
