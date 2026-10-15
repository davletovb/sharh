import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm', base = `chrome-extension://${id}`;

test('Settings → Lenses saves, edits, exports, imports and deletes custom lenses that reach the lens bar', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-lenses-')), extension = resolve('dist/sharh'), report = {checks: {}, errors: []};
  const context = await chromium.launchPersistentContext(profile, {...browserOptions(), channel: 'chromium', args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']});
  context.setDefaultTimeout(20000);
  try {
    const settings = await context.newPage();
    settings.on('pageerror', e => report.errors.push(e.message));
    await settings.goto(base + '/ui/settings.html#lenses');
    await settings.getByRole('heading', {name: 'Lenses', level: 2}).waitFor();
    assert.match(await settings.locator('.lens-list').textContent(), /No custom lenses yet/);

    // Choosing a type chooses what it refers to; clearing it clears what depends on it.
    await settings.getByLabel('Excerpts', {exact: false}).check();
    for (const label of ['Themes', 'Codes']) assert.equal(await settings.getByRole('checkbox', {name: new RegExp('^' + label)}).isChecked(), true);
    await settings.getByRole('checkbox', {name: /^Themes/}).uncheck();
    assert.equal(await settings.getByRole('checkbox', {name: /^Excerpts/}).isChecked(), false);
    report.checks.dependencies = true;

    await settings.getByRole('textbox', {name: 'Name'}).fill('Appeals to authority');
    await settings.getByRole('textbox', {name: 'Instructions'}).fill('Find every appeal to authority and say whether it is explicit.');
    await settings.getByRole('checkbox', {name: /^Claims and points/}).check();
    await settings.getByRole('button', {name: 'Save lens'}).click();
    await settings.locator('.lens-card').filter({hasText: 'Appeals to authority'}).waitFor();
    assert.match(await settings.locator('#lenses-content .status-line').textContent(), /Saved/);
    report.checks.saved = true;

    // The side panel's lens bar offers it.
    const panel = await context.newPage();
    await panel.goto(base + '/ui/reader.html');
    await panel.locator('.workspace-nav').waitFor();
    await panel.waitForFunction(() => [...document.querySelectorAll('.workspace select option')].some(o => o.textContent === 'Appeals to authority'));
    await panel.locator('.workspace-nav').getByRole('button', {name: 'Analyze', exact: true}).click();
    await panel.locator('.lens-bar').getByRole('button', {name: 'More'}).click();
    await panel.getByRole('menuitem', {name: 'Appeals to authority'}).waitFor();
    await panel.keyboard.press('Escape');
    report.checks.reachesWorkspace = true;

    // Edit, export, import, delete.
    await settings.getByRole('button', {name: 'Edit Appeals to authority'}).click();
    await settings.getByRole('textbox', {name: 'Name'}).fill('Appeals');
    await settings.getByRole('button', {name: 'Save lens'}).click();
    await settings.locator('.lens-card').filter({hasText: 'Appeals'}).waitFor();
    assert.equal(await settings.locator('.lens-card').count(), 1);
    const [download] = await Promise.all([settings.waitForEvent('download'), settings.getByRole('button', {name: 'Export Appeals'}).click()]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.format, 'sharh-lens');
    await settings.getByRole('button', {name: 'Delete Appeals'}).click();
    await settings.getByText('No custom lenses yet').waitFor();
    await settings.getByLabel('Import a lens file').setInputFiles({name: 'lens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
    await settings.locator('.lens-card').filter({hasText: 'Appeals'}).waitFor();
    await settings.getByLabel('Import a lens file').setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"other"}')});
    await settings.getByText('That is not a Sharh lens file.').waitFor();
    report.checks.editExportImportDelete = true;
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/settings-lenses.json', JSON.stringify(report, null, 2) + '\n');
  }
});
