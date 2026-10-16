import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
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

    // Collections: save two readings, start a collection, add both, put them in order, compare, delete.
    await page.getByRole('tab', {name: 'Collections'}).click();
    assert.equal(await page.getByLabel('Collection', {exact: true}).isVisible(), false, 'the Studio controls stay out of the page');
    await page.getByText('No collections yet.').waitFor();
    await page.getByRole('button', {name: 'Save what is open'}).click();
    await page.locator('.saved-text').first().waitFor();
    await page.locator('#open-file').setInputFiles({name: 'second.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Second local file</h1><p>Second source content.</p>')});
    await page.locator('.convo-stream').waitFor();
    await page.locator('#open-library').click();
    await page.getByRole('tab', {name: 'Collections'}).click();
    await page.getByRole('button', {name: 'Save what is open'}).click();
    await page.locator('.saved-text').nth(1).waitFor();
    const titles = await page.locator('.saved-text-title').allTextContents();
    assert.equal(titles.length, 2);
    await page.getByLabel('Name for a new collection').fill('Reading list');
    await page.getByRole('button', {name: 'Start collection'}).click();
    await page.getByRole('heading', {name: 'Reading list', level: 4}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Reading list 0 texts'}).getAttribute('aria-current'), 'true');
    assert.equal(await page.getByRole('button', {name: 'Literature review of Reading list'}).isDisabled(), true, 'one text cannot be read together');
    for (const at of [0, 1]) {
      await page.getByLabel('Saved text to add').selectOption({index: 1});
      await page.getByRole('button', {name: 'Add to collection'}).click();
      await page.locator('.coll-members li').nth(at).waitFor();
    }
    assert.equal(await page.getByLabel('Saved text to add').isDisabled(), true, 'everything saved is already in the collection');
    assert.equal(await page.getByRole('button', {name: 'Literature review of Reading list'}).isEnabled(), true);
    const order = async () => page.locator('.coll-member-title').allTextContents();
    const before = await order();
    await page.getByRole('button', {name: `Move ${before[0]} later`}).click();
    await page.waitForFunction(first => document.querySelector('.coll-member-title')?.textContent !== first, before[0]);
    assert.deepEqual(await order(), [before[1], before[0]]);
    await page.getByRole('button', {name: `Remove ${before[1]} from Reading list`}).click();
    await page.waitForFunction(() => document.querySelectorAll('.coll-members li').length === 1);
    assert.equal(await page.getByRole('button', {name: 'Reading list 1 text'}).count(), 1);
    // Compare needs exactly two picked texts.
    assert.equal(await page.getByRole('button', {name: 'Compare the two picked'}).isDisabled(), true);
    await page.getByLabel(`Pick ${titles[0]} to compare`).check();
    await page.getByLabel(`Pick ${titles[1]} to compare`).check();
    assert.equal(await page.getByRole('button', {name: 'Compare the two picked'}).isEnabled(), true);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], `collections ${scheme}`);
    }
    // A second collection can be ordered and the first deleted, after a confirmation.
    await page.getByLabel('Name for a new collection').fill('Later');
    await page.getByRole('button', {name: 'Start collection'}).click();
    await page.getByRole('heading', {name: 'Later', level: 4}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Move Later later in the list'}).isDisabled(), true);
    await page.getByRole('button', {name: 'Move Later earlier in the list'}).click();
    await page.waitForFunction(() => document.querySelector('.coll-pick strong')?.textContent === 'Later');
    await page.getByRole('button', {name: 'Reading list 1 text'}).click();
    await page.getByRole('button', {name: /Delete (collection|for good)/}).click();
    assert.equal(await page.getByRole('button', {name: 'Reading list 1 text'}).count(), 1, 'one click only asks');
    await page.getByRole('button', {name: /Delete (collection|for good)/}).click();
    await page.waitForFunction(() => !document.querySelector('.coll-list')?.textContent.includes('Reading list'));
    assert.equal(await page.getByRole('tabpanel', {name: 'Documents'}).isVisible(), false);
    report.checks.collections = true;

    // The tab list works from the keyboard.
    await page.getByRole('tab', {name: 'Collections'}).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', {name: 'Books'}).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', {name: 'Start chapter digests'}).waitFor();
    await page.getByLabel('Failover tier').waitFor();
    report.checks.booksAndKeyboard = true;

    // Glossary: terms of a book, added, filtered, edited and deleted.
    await page.keyboard.press('ArrowRight');
    await page.getByLabel('Glossary of').waitFor();
    assert.match(await page.locator('.terms').textContent(), /No terms yet/);
    const addTerm = async (term, translation, aliases = '') => {
      await page.getByLabel('Term in the text').fill(term);
      await page.getByLabel('Translation to use').fill(translation);
      await page.getByLabel('Other spellings (comma separated)').fill(aliases);
      await page.getByRole('button', {name: 'Save term'}).click();
      await page.locator('.terms .glossary-item').filter({hasText: term}).waitFor();
    };
    await addTerm('dalil', 'evidence', 'далил');
    await addTerm('sharh', 'commentary');
    assert.equal(await page.locator('.terms .glossary-item').count(), 2);
    assert.match(await page.locator('.terms .glossary-item').filter({hasText: 'dalil'}).textContent(), /also далил/);
    await page.getByLabel('Filter terms').fill('comm');
    await page.waitForFunction(() => document.querySelectorAll('.terms .glossary-item').length === 1);
    await page.getByLabel('Filter terms').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.terms .glossary-item').length === 2);
    await page.getByRole('button', {name: 'Edit dalil'}).click();
    assert.equal(await page.getByLabel('Term in the text').inputValue(), 'dalil');
    await page.getByLabel('Term in the text').fill('daleel');
    await page.getByRole('button', {name: 'Save term'}).click();
    await page.locator('.terms .glossary-item').filter({hasText: 'daleel'}).waitFor();
    assert.equal(await page.locator('.terms .glossary-item').count(), 2);
    await page.getByRole('button', {name: 'Delete sharh'}).click();
    await page.getByRole('button', {name: 'Delete sharh'}).click();
    await page.waitForFunction(() => document.querySelectorAll('.terms .glossary-item').length === 1);
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
    await page.locator('#saved-documents').getByRole('button', {name: 'Open', exact: true}).first().click();
    await page.locator('.convo-stream').waitFor();
    report.checks.openFromLibrary = true;

    // Deleting every document leaves an empty Library.
    await page.locator('#open-library').click();
    await page.getByRole('tab', {name: 'Documents'}).click();
    for (let left = await page.locator('#saved-documents article').count(); left > 0; left--) {
      await page.locator('#saved-documents').getByRole('button', {name: 'Delete', exact: true}).first().click();
      await page.waitForFunction(n => document.querySelectorAll('#saved-documents article').length === n - 1, left);
    }
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

test('Books page: a card per job with progress and the right next action', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sharh-books-')), extension = resolve('dist/sharh'), report = {checks: {}, errors: []};
  const context = await chromium.launchPersistentContext(profile, {...browserOptions(), channel: 'chromium', args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']});
  context.setDefaultTimeout(20000);
  try {
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(base + '/ui/reader.html');
    await page.getByRole('tablist', {name: 'Library'}).waitFor();
    await page.getByRole('tab', {name: 'Books'}).click();
    // Nothing open and no jobs yet.
    await page.getByText('No book jobs yet.').waitFor();
    assert.equal(await page.getByRole('button', {name: 'Start chapter digests'}).isDisabled(), true);
    // With a reading open, the first job can be started from here.
    await page.locator('#open-file').setInputFiles({name: 'book.html', mimeType: 'text/html', buffer: Buffer.from('<h1>A small book</h1><p>One.</p><h2>Part</h2><p>Two.</p>')});
    await page.waitForFunction(() => document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    await page.locator('#open-library').click();
    await page.getByRole('tab', {name: 'Books'}).click();
    assert.equal(await page.getByRole('button', {name: 'Start chapter digests'}).isEnabled(), true);
    report.checks.startCard = true;

    // Two saved jobs: one paused part-way with a message, one finished.
    await installBrowserTestAPI(page);
    await page.evaluate(async () => {
      const store = await SharhTest.openDocumentStore(), [doc] = (await store.listDocuments()).filter(d => !d.derived);
      const chapters = n => Array.from({length: 3}, (_, i) => ({title: `Chapter ${i + 1}`, span: [i + 1, i + 1], completed: i < n, runId: 'r' + i}));
      const base = {kind: 'book', docId: doc.id, extractionVersion: doc.version, scope: {kind: 'document', label: 'Whole document'}, policy: {mode: 'ask', targets: []}};
      await store.put('jobs', {...base, id: 'job-paused', state: 'paused', chapters: chapters(1), next: 1, createdAt: 2, error: {code: 'JOB_FAILED', message: 'The model stopped answering.'}});
      await store.put('jobs', {...base, id: 'job-done', state: 'completed', chapters: chapters(3), next: 3, createdAt: 1});
      store.close();
    });
    await page.reload();
    await page.getByRole('tablist', {name: 'Library'}).waitFor();
    await page.getByRole('tab', {name: 'Books'}).click();
    const cards = page.locator('.job-card');
    await cards.nth(1).waitFor();
    assert.equal(await cards.count(), 2);
    const paused = cards.filter({hasText: 'Paused'}), done = cards.filter({hasText: 'Done'});
    assert.match(await paused.textContent(), /1 of 3 chapters/);
    assert.match(await paused.textContent(), /The model stopped answering\./);
    assert.equal(await paused.getByRole('button', {name: 'Resume'}).isVisible(), true);
    assert.equal(await paused.getByRole('button', {name: 'Analyze digests'}).count(), 0);
    assert.match(await done.textContent(), /3 of 3 chapters/);
    assert.equal(await done.getByRole('button', {name: 'Analyze digests'}).isVisible(), true);
    await done.getByLabel('Read the digests as').selectOption('logic');
    await done.locator('.job-chapters summary').click();
    assert.equal(await done.locator('.job-chapters li').count(), 3);
    report.checks.jobCards = true;

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    report.checks.accessibility = true;
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/books.json', JSON.stringify(report, null, 2) + '\n');
  }
});
