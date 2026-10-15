import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions, serveRepository} from '../../scripts/lib/browser-fixtures.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm', base = `chrome-extension://${id}`;
const READY = {path: 'seatline', provider: 'claude', label: 'Claude Code', available: true, signedIn: true, accepted: true, models: [], capabilities: {streaming: true, sessions: true, toolIsolation: true, effort: ['low', 'medium', 'high']}};
// The panel talks to the worker over a port. This stands in for a connected Seatline with one ready provider.
async function start(providers) {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-states-')), extension = resolve('dist/sharh');
  const context = await chromium.launchPersistentContext(profile, {...browserOptions(), channel: 'chromium', args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']});
  context.setDefaultTimeout(20000);
  await context.addInitScript(list => {
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.connect !== 'function' || !chrome.runtime.id) return;
    const real = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = info => {
      if (info?.name !== 'sharh:path') return real(info);
      const listeners = [];
      return {name: info.name, onMessage: {addListener: f => listeners.push(f)}, onDisconnect: {addListener() {}}, disconnect() {},
        postMessage(message) { setTimeout(() => listeners.forEach(f => f({id: message.id, result: message.method === 'discover' ? list : null})), 0); }};
    };
  }, providers);
  return {profile, context};
}
const hostPermission = (management, origin, add) => management.evaluate(async ({id, origin, add}) => add ? chrome.developerPrivate.addHostPermission(id, origin + '/*') : chrome.developerPrivate.removeHostPermission(id, origin + '/*'), {id, origin, add});

test('J: a connected panel asks before reading, offers Not now, and reads on its own only when the setting and site access allow it', async () => {
  const {profile, context} = await start([READY]), server = await serveRepository(), report = {checks: {}, errors: []};
  try {
    const source = await context.newPage();
    await source.goto(server.url + '/corpus/fixtures/html/article-en.html');
    const panel = await context.newPage();
    panel.on('pageerror', e => report.errors.push(e.message));
    await panel.goto(base + '/ui/panel.html');
    // A page the extension cannot see is still a page the reader can choose to read.
    await panel.locator('#state-consent').waitFor();
    assert.equal(await panel.locator('#state-connect').isVisible(), false);
    await source.bringToFront();
    await panel.waitForFunction(() => document.querySelector('#h-consent').textContent === 'Read this page?');
    assert.equal(await panel.locator('#read-page').isVisible(), true);
    assert.equal(await panel.locator('#state-reading').isVisible(), false);
    report.checks.asksBeforeReading = true;
    await panel.locator('#not-now').click();
    assert.equal(await panel.locator('#state-consent.compact').count(), 1);
    assert.equal(await panel.locator('#read-page').isVisible(), true);
    report.checks.notNow = true;

    // The reader chooses automatic reading, but Sharh cannot see this site yet, so it still asks.
    await panel.evaluate(() => chrome.storage.local.set({sharhReading: {autoRead: 'allowed'}}));
    await panel.waitForTimeout(700);
    assert.equal(await panel.locator('#state-reading').isVisible(), false);
    report.checks.noAutoReadWithoutAccess = true;

    // Once the site is allowed, the next load of that page is read without asking.
    const management = await context.newPage();
    await management.goto('chrome://extensions/');
    // Chrome only grants an optional site from a click. The extensions page pre-approves the prompt.
    await hostPermission(management, server.url, true);
    await panel.evaluate(origin => {
      const b = document.createElement('button');
      b.id = 'grant-site';
      b.textContent = 'grant';
      b.onclick = async () => { window.granted = await chrome.permissions.request({origins: [origin + '/*']}); };
      document.body.append(b);
    }, server.url);
    await panel.locator('#grant-site').click();
    await panel.waitForFunction(() => window.granted === true);
    await source.bringToFront();
    await source.reload();
    await panel.locator('#state-reading').waitFor();
    assert.match(await panel.locator('.workspace-title').textContent(), /\S/);
    report.checks.autoReadWhenAllowed = true;

    // With the setting back on "Ask me first", reading again needs a click.
    await panel.evaluate(() => chrome.storage.local.set({sharhReading: {autoRead: 'never'}}));
    await panel.getByRole('button', {name: 'Sharh menu'}).click();
    await panel.getByRole('menuitem', {name: 'Close this reading'}).click();
    await panel.locator('#state-consent').waitFor();
    await source.bringToFront();
    await source.reload();
    await panel.waitForTimeout(700);
    assert.equal(await panel.locator('#state-reading').isVisible(), false);
    await panel.locator('#read-page').click();
    await panel.locator('#state-reading').waitFor();
    report.checks.readsOnRequest = true;

    // "Read this page" in the right-click menu is itself the request, so it reads without a second question.
    await panel.getByRole('button', {name: 'Sharh menu'}).click();
    await panel.getByRole('menuitem', {name: 'Close this reading'}).click();
    await panel.locator('#state-consent').waitFor();
    await source.bringToFront();
    const tabId = await panel.evaluate(async origin => (await chrome.tabs.query({url: origin + '/*'}))[0].id, server.url);
    await panel.evaluate(tabId => chrome.storage.session.set({'sharh:read-intent': {tabId, at: Date.now()}}), tabId);
    await panel.locator('#state-reading').waitFor();
    assert.equal(await panel.evaluate(async () => (await chrome.storage.session.get('sharh:read-intent'))['sharh:read-intent'] ?? null), null);
    report.checks.menuReadRequest = true;
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    await context.close();
    await server.close();
    await rm(profile, {recursive: true, force: true});
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/panel-states.json', JSON.stringify(report, null, 2) + '\n');
  }
});
