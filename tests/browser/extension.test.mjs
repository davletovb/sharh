import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm';
test('packaged MV3 worker, settings and side panel load with fixed identity and optional hosts', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-extension-')),
    extension = resolve('dist/sharh');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...browserOptions(),
      channel: 'chromium',
      args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      ignoreDefaultArgs: ['--disable-extensions']
    });
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    assert.equal(worker.url(), `chrome-extension://${id}/worker.mjs`);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/ui/settings.html`);
    await page.waitForFunction(() =>
      document.querySelector('#authorize').textContent.includes('authorize sharh')
    );
    const command = await page.locator('#authorize').textContent();
    assert.ok(command.includes(`chrome-extension://${id}/`));
    assert.equal(await page.locator('#gemini-cloud').isChecked(), false);
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.incognito, 'not_allowed');
    assert.deepEqual(manifest.permissions, [
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'nativeMessaging',
      'contextMenus',
      'scripting',
      'activeTab'
    ]);
    assert.equal(
      await page.evaluate(() => chrome.permissions.contains({origins: ['https://example.com/*']})),
      false
    );
    const copied = await page.evaluate(async () => {
      let text;
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (value) => {
            text = value;
          }
        }
      });
      document.querySelector('#copy').click();
      await Promise.resolve();
      return text;
    });
    assert.equal(copied, command);
    await page.locator('#check').click();
    await page.waitForFunction(
      () => document.querySelector('#check-state').textContent === 'Fresh check complete.'
    );
    assert.equal(await page.locator('[data-state="companion_missing"]').count(), 4);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/ui/panel.html`);
    assert.equal(await panel.title(), 'Sharh');
    await panel.locator('#settings').click();
    await page.waitForFunction(() => document.querySelector('#gemini-cloud') != null);
    assert.ok((await readFile('dist/sharh/worker.mjs', 'utf8')).includes('send_ready_with_policy'));
    // Exercise the actual run-status binding: queued text, busy retry and stop, with no model call.
    const runUI = await panel.evaluate(async () => {
      const {bindRuns} = await import('./runs.mjs');
      let attempts = 0;
      const state = document.createElement('p'),
        retry = document.createElement('button'),
        stop = document.createElement('button');
      const view = bindRuns(
        {
          async call(method, params, {onEvent, signal}) {
            attempts++;
            onEvent({type: 'queued', ahead: 2});
            if (attempts === 1)
              throw Object.assign(Error('Seatline is busy. Retry when a slot is free.'), {code: 'BUSY'});
            return {truncated: false};
          }
        },
        {state, retry, stop}
      );
      try {
        await view.run({}, {});
      } catch {}
      const busy = {text: state.textContent, retry: !retry.hidden};
      retry.click();
      await new Promise((r) => setTimeout(r, 0));
      return {busy, attempts, final: state.textContent};
    });
    assert.equal(runUI.busy.retry, true);
    assert.match(runUI.busy.text, /busy/);
    assert.equal(runUI.attempts, 2);
    assert.equal(runUI.final, 'Completed');
  } finally {
    await context?.close();
    await rm(profile, {recursive: true, force: true});
  }
});
