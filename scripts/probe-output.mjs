import {parseArgs} from 'node:util';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {nativePort} from './lib/native-stdio.mjs';
import {probeClient} from './lib/probe-client.mjs';
import {fixtureBrowser} from './lib/browser-fixtures.mjs';
import {runOutputProbe, reportPasses} from './lib/run-output-probe.mjs';
const {values} = parseArgs({options:{fixture:{type:'boolean'}, companion:{type:'string'}, provider:{type:'string',multiple:true}, model:{type:'string'}, item:{type:'string',multiple:true}, out:{type:'string',default:'test-results/output.json'}, 'allow-gemini-cloud':{type:'boolean'}, 'stand-in':{type:'boolean'}}});
if (!values.fixture && !values.companion) throw new Error('Use --fixture or --companion /absolute/path/to/seatline-companion');
if (values.fixture && values.companion) throw new Error('--fixture and --companion are mutually exclusive');
const contract = JSON.parse(await readFile('config/seatline-contract.json'));
const corpus = JSON.parse(await readFile('corpus/manifest.json'));
const providers = values.provider ?? ['claude','codex'];
if (providers.some(p => !contract.providers.includes(p))) throw new Error('UNKNOWN_PROVIDER');
const items = corpus.items.filter(i => !values.item || values.item.includes(i.id));
if (!items.length || values.item?.some(id => !items.some(i => i.id === id))) throw new Error('UNKNOWN_CORPUS_ITEM');
let client, browser;
try {
  browser = await fixtureBrowser();
  if (!values.fixture) client = probeClient(nativePort(resolve(values.companion), `chrome-extension://${contract.development_extension_id}/`), {timeoutMs: 900000});
  const report = await runOutputProbe({client, items, providers, extract:browser.extract, contract, fixture:values.fixture, allowGeminiCloud:values['allow-gemini-cloud'], model:values.model});
  if (values['stand-in']) { report.kind = 'seatline-stand-in'; report.liveProviderClaim = false; }
  report.passed = reportPasses(report);
  await mkdir(dirname(values.out), {recursive:true}); await writeFile(values.out, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({kind:report.kind, passed:report.passed, runs:report.runs.length, report:values.out}));
  if (!report.passed) process.exitCode = 1;
} finally { client?.close(); await browser?.close(); }
