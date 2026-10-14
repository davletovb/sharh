import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {probeClient,probeStatuses} from './lib/probe-client.mjs';
import {nativePort} from './lib/native-stdio.mjs';
const {values} = parseArgs({options:{companion:{type:'string'},out:{type:'string',default:'test-results/authorization.json'}}});
if (!values.companion) throw new Error('Use --companion /absolute/path/to/seatline-companion (after install/authorize)');
const contract=JSON.parse(await readFile('config/seatline-contract.json'));
const client=probeClient(nativePort(resolve(values.companion),`chrome-extension://${contract.development_extension_id}/`));
try {
  const report={kind:'native-stdio-authorization',seatlineRevision:contract.revision,extensionId:contract.development_extension_id,ready:await client.ready,providers:await probeStatuses(client,contract.providers)};
  report.passed=report.providers.every(p=>p.status);
  await mkdir(dirname(values.out),{recursive:true}); await writeFile(values.out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,report:values.out})); if (!report.passed) process.exitCode=1;
} finally { client.close(); }
