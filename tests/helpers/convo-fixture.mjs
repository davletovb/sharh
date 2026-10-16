import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from './browser-api-loader.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm', base = `chrome-extension://${id}`;
export {base};

export async function setup({signedIn = true} = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-convo-')), extension = resolve('dist/sharh');
  const context = await chromium.launchPersistentContext(profile, {...browserOptions(), channel: 'chromium', args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']});
  context.setDefaultTimeout(20000);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/ui/settings.html');
  await installBrowserTestAPI(page);
  await page.evaluate(async signedIn => {
    const {openDocumentStore, exampleDocument, AnalysisEngine, FakePath, createWorkspace, phaseOneOutput, phaseTwoOutput} = SharhTest;
    const store = await openDocumentStore({name: 'convo'}), doc = await exampleDocument();
    await store.saveDocument(doc);
    const info = {path: 'fake', provider: 'fixture', label: 'Scripted fixture', available: true, signedIn, accepted: true, models: [], capabilities: {streaming: true, sessions: true, toolIsolation: true}};
    const line = (...r) => r.map(JSON.stringify).join('\n') + '\n';
    const path = new FakePath({wait: async () => {}, scriptFor: ({request}) => {
      const task = JSON.parse(request.task.split('\n')[1]), source = {title: doc.title, lang: 'en', blocks: doc.blocks};
      if (task.operation === 'ask') return {text: line({t: 'note', text: 'Grounded answer [¶3]. <svg onload=alert(1)>', refs: [3]}, {t: 'end'})};
      return {text: task.action || ['summary', 'structure', 'logic', 'thinking'].includes(task.lens) ? phaseOneOutput(task, source) : phaseTwoOutput(task, source)};
    }});
    path.discover = async () => [info];
    const engine = new AnalysisEngine({store, paths: {fake: path}}), host = document.createElement('main');
    host.id = 'convo-fixture';
    document.body.append(host);
    const storage = {data: {}, async get(k) { return typeof k === 'string' ? {[k]: this.data[k]} : {...this.data}; }, async set(v) { Object.assign(this.data, v); }};
    const workspace = await createWorkspace(host, {store, engine, client: {call: async m => m === 'discover' ? [info] : null}, storage, surface: 'panel', layout: 'conversation', changes: {addListener() {}, removeListener() {}}});
    await workspace.ready;
    await workspace.setDocument(doc);
    window.c = {store, doc, path, engine, workspace};
  }, signedIn);
  return {profile, context, page, errors, root: page.locator('#convo-fixture'), async close() { await context.close(); await rm(profile, {recursive: true, force: true}); }};
}
export async function axe(page) {
  const cdp = await page.context().newCDPSession(page);
  try { await cdp.send('Runtime.evaluate', {expression: await readFile('node_modules/axe-core/axe.min.js', 'utf8')}); } finally { await cdp.detach(); }
  return page.evaluate(async () => (await window.axe.run(document.querySelector('#convo-fixture'), {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}})).violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)})));
}
export const idle = async (page, count) => { await page.waitForFunction(count => c.path.calls.length >= count && !c.workspace.active, count); await page.evaluate(() => c.workspace.view?.settled()); };

