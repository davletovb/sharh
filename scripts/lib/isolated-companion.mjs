import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm, access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
export async function isolatedCompanion(companion, fakeProvider) {
  if (process.platform !== 'linux') throw new Error('ISOLATED_COMPANION_REQUIRES_LINUX');
  const contract = JSON.parse(await readFile('config/seatline-contract.json'));
  const origin = `chrome-extension://${contract.development_extension_id}/`;
  const root = await mkdtemp(join(homedir(), 'sharh-foundation-')); await chmod(root, 0o700);
  const data = join(root, 'data'), providers = join(root, 'providers');
  await mkdir(providers, {mode:0o700});
  const env = {HOME:homedir(), PATH:'/usr/bin:/bin', LANG:'C.UTF-8', SEATLINE_DATA_DIR:data, XDG_CONFIG_HOME:join(root,'config'), XDG_CACHE_HOME:join(root,'cache'), XDG_DATA_HOME:join(root,'provider-data'), SHARH_PROVIDER_PATH:providers, SEATLINE_BROKER_IDLE_SECS:'2'};
  const run = (...args) => execFileSync(resolve(companion), args, {env, stdio:['ignore','pipe','pipe'],timeout:15000});
  let server;
  async function close() {
    if (server && server.exitCode === null) {
      const done = new Promise(resolve => server.once('exit', resolve)); server.kill();
      const timer = setTimeout(() => server.kill('SIGKILL'), 2500);
      await done; clearTimeout(timer);
    }
    await rm(root,{recursive:true,force:true});
  }
  try {
    for (const provider of ['claude','codex']) {
      await writeFile(join(providers,provider), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fileURLToPath(new URL('./stand-in-cli.mjs',import.meta.url)))} ${provider} "$@"\n`, {mode:0o700});
    }
    for (const provider of ['agy','grok']) { await copyFile(fakeProvider,join(providers,provider)); await chmod(join(providers,provider),0o700); }
    run('install'); run('authorize','sharh',contract.providers.join(','),origin,'--cache-title=Sharh');
    const installed = (await readFile(join(data,'companion-executable'),'utf8')).trim();
    server = spawn(installed,['serve'],{env,stdio:'ignore'});
    let found = false;
    for (let i=0;i<200;i++) {
      try { await access(join(data,'broker.sock')); found=true; break; } catch { await new Promise(resolve => setTimeout(resolve,25)); }
    }
    if (!found) throw new Error('BROKER_START_TIMEOUT');
    return {root,data,providers,env,origin,installed,contract,run,close};
  } catch (error) { await close(); throw error; }
}
