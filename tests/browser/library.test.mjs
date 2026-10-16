import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm', base = `chrome-extension://${id}`;
async function axe(page) {
  const cdp = await page.context().newCDPSession(page);
  try { await cdp.send('Runtime.evaluate', {expression: await readFile('node_modules/axe-core/axe.min.js', 'utf8')}); } finally { await cdp.detach(); }
  return page.evaluate(async () => (await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}})).violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)})));
}

test('Library page: documents, collections, books and glossary on the full tab', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-library-')), extension = resolve('dist/sharh'), report = {checks: {}, errors: []};
  const context = await chromium.launchPersistentContext(profile, {...browserOptions(), channel: 'chromium', args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']});
  context.setDefaultTimeout(20000);
  try {
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(base + '/ui/reader.html');
    // With nothing open, the Library is the home page.
    await page.getByRole('tablist', {name: 'Library'}).waitFor();
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Documents', 'Collections', 'Books', 'Glossary']);
    assert.equal(await page.getByRole('tab', {name: 'Documents'}).getAttribute('aria-selected'), 'true');
    await page.locator('#saved-empty').waitFor();
    assert.equal(await page.locator('.convo-stream').first().isVisible(), false);
    report.checks.emptyHome = true;

    // Reading something adds it to Documents.
    await page.locator('#open-file').setInputFiles({name: 'index.html', mimeType: 'text/html', buffer: Buffer.from('<h1>First local file</h1><p>First source content.</p>')});
    await page.waitForFunction(() => document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    await page.locator('.convo-stream').waitFor();
    await page.locator('#open-library').click();
    await page.getByRole('tablist', {name: 'Library'}).waitFor();
    const row = page.locator('#saved-documents article');
    assert.equal(await row.count(), 1);
    assert.match(await row.first().textContent(), /HTML/);
    assert.equal(await page.locator('#saved-empty').isVisible(), false);
    report.checks.documentRow = true;

    // Collections: save the reading, make a collection, add it, see it in order.
    await page.getByRole('tab', {name: 'Collections'}).click();
    await page.getByRole('button', {name: 'Save current scope to library'}).click();
    await page.getByLabel('Saved library items').locator('option').first().waitFor({state: 'attached'});
    await page.getByLabel('New collection name').fill('Reading list');
    await page.getByRole('button', {name: 'Create collection'}).click();
    // Creating a collection reloads the lists, so wait for it to be chosen before selecting an item.
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some(el => el.selectedOptions[0]?.textContent === 'Reading list'));
    await page.getByLabel('Saved library items').selectOption({index: 0});
    await page.getByRole('button', {name: 'Add selected items to collection'}).click();
    await page.locator('.collection-item').first().waitFor();
    assert.equal(await page.locator('.collection-item').count(), 1);
    assert.equal(await page.getByRole('tabpanel', {name: 'Documents'}).isVisible(), false);
    report.checks.collections = true;

    // The tab list works from the keyboard.
    await page.getByRole('tab', {name: 'Collections'}).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', {name: 'Books'}).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', {name: 'Start chapter digests'}).waitFor();
    await page.getByLabel('Failover tier').waitFor();
    report.checks.booksAndKeyboard = true;

    // Glossary belongs to the open reading.
    await page.keyboard.press('ArrowRight');
    await page.locator('.glossary-note').waitFor();
    await page.getByLabel('Source term', {exact: true}).fill('dalil');
    await page.getByLabel('Chosen translation', {exact: true}).fill('evidence');
    await page.getByRole('button', {name: 'Save glossary entry'}).click();
    await page.locator('.glossary-item').filter({hasText: 'dalil'}).waitFor();
    report.checks.glossary = true;

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    report.checks.accessibility = true;

    // Back to the reading, then open a saved document from the Library and land in the reading.
    await page.getByRole('button', {name: '← Back to the reading'}).click();
    await page.locator('.convo-stream').waitFor();
    await page.locator('#open-library').click();
    await page.getByRole('tab', {name: 'Documents'}).click();
    await page.locator('#saved-documents').getByRole('button', {name: 'Open', exact: true}).click();
    await page.locator('.convo-stream').waitFor();
    report.checks.openFromLibrary = true;

    // Deleting the last document leaves an empty Library.
    await page.locator('#open-library').click();
    await page.getByRole('tab', {name: 'Documents'}).click();
    await page.locator('#saved-documents').getByRole('button', {name: 'Delete', exact: true}).click();
    await page.locator('#saved-empty').waitFor();
    report.checks.delete = true;
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/library.json', JSON.stringify(report, null, 2) + '\n');
  }
});
