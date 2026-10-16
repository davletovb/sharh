import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {setup, axe, idle} from '../helpers/convo-fixture.mjs';

// Run one reading from the "More ways to read" menu and wait until its card is complete.
async function runWay(w, name) {
  const {page, root} = w, before = await root.locator('.convo-card').count();
  await root.getByRole('button', {name: 'More ways to read'}).click();
  await root.getByRole('menuitem', {name, exact: true}).click();
  await page.waitForFunction(count => document.querySelectorAll('#convo-fixture .convo-card').length > count && !c.workspace.active, before);
  await page.evaluate(() => c.workspace.view?.settled());
  return root.locator('.convo-card').nth(before);
}

test('Conversation cards stand alone: plain labels, no repeated table, the map on request', async () => {
  const w = await setup(), report = {checks: {}}, {page, root} = w;
  try {
    // The argument is words first. The map opens only when asked for.
    await root.locator('.goals').getByRole('button', {name: 'Check the argument'}).click();
    await root.locator('.convo-card').first().waitFor();
    await idle(page, 1);
    const argument = root.locator('.convo-card').first(), toggle = argument.getByRole('button', {name: 'Show map'});
    assert.equal(await argument.locator('.map-shell').isVisible(), false);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await argument.getByRole('button', {name: 'Zoom in'}).count(), 0, 'no map controls until the map is shown');
    assert.match(await argument.locator('.finding.edge p').first().textContent(), /Deterministic fixture.*→.*Deterministic fixture/);
    assert.match(await argument.locator('.basis').first().textContent(), /^(Stated in the text|Inferred)$/);
    await toggle.click();
    assert.equal(await argument.locator('.map-shell').isVisible(), true);
    assert.equal(await argument.getByRole('button', {name: 'Hide map'}).getAttribute('aria-expanded'), 'true');
    await argument.getByRole('button', {name: 'Hide map'}).click();
    assert.equal(await argument.locator('.map-shell').isVisible(), false);
    report.checks.mapOnRequest = true;

    // Themes and citations are cards, not a table plus the same cards again.
    const themes = await runWay(w, 'Themes');
    assert.equal(await themes.locator('table').count(), 0);
    assert.ok(await themes.locator('.finding.theme').count());
    const cites = await runWay(w, 'Who it cites');
    assert.equal(await cites.locator('table').count(), 0);
    assert.ok(await cites.locator('.finding.cite').count());
    report.checks.noRepeatedTable = true;

    // Kinds and levels are said in plain words.
    const kind = await runWay(w, 'What kind of text this is');
    const kindTitles = await kind.locator('.finding h5').allTextContents();
    assert.deepEqual(kindTitles, ['Genre', 'Who it is for', 'What it is for', 'Where the author stands', 'Context', 'How it is framed', 'What is left unsaid']);
    const questions = await runWay(w, 'Questions to check yourself');
    assert.deepEqual(await questions.locator('.finding h5').allTextContents(), ['Did you follow it?', 'Look closer', 'Weigh it', 'Argue about it']);
    report.checks.plainLabels = true;

    // Strengths, limits and the quality of the evidence are three groups, each in its place.
    const critique = await runWay(w, 'Strengths and weak points');
    assert.deepEqual(await critique.locator('.record-group > h4').allTextContents(), ['Strengths', 'Limitations and counterarguments', 'Quality of the evidence']);
    assert.deepEqual(await critique.locator('.record-group').nth(1).locator('.finding h5').allTextContents(), ['Weakness', 'A counterargument']);
    assert.deepEqual(await critique.locator('.record-group').nth(2).locator('.finding h5').allTextContents(), ['Quality of the evidence']);
    report.checks.critiqueGroups = true;

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    assert.deepEqual(w.errors, []);
    report.passed = true;
  } finally {
    await w.close();
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/readings.json', JSON.stringify(report, null, 2) + '\n');
  }
});

test('Study it deeply shows three readings and no empty card', async () => {
  const w = await setup(), {page, root} = w;
  try {
    await root.locator('.goals').getByRole('button', {name: 'Study it deeply'}).click();
    await page.waitForFunction(() => document.querySelectorAll('#convo-fixture .convo-card').length >= 3 && !c.workspace.active);
    await page.evaluate(() => c.workspace.view?.settled());
    const titles = await root.locator('.convo-card-title').allTextContents();
    assert.deepEqual(titles, ['How it is built', 'The argument', 'How it thinks']);
    for (const card of await root.locator('.convo-card').all()) assert.ok(await card.locator('.finding').count(), 'every card has findings');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('Learn the terms: a short list, each term can be kept, and only kept terms are used', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  try {
    await root.locator('.goals').getByRole('button', {name: 'Learn the terms'}).click();
    await root.locator('.convo-card').first().waitFor();
    await idle(page, 1);
    const card = root.locator('.convo-card').first();
    // One presentation, at most eight terms, each with Keep.
    assert.equal(await card.locator('table').count(), 0);
    const terms = await card.locator('.finding.term').count();
    assert.ok(terms >= 2 && terms <= 8);
    assert.equal(await card.getByRole('button', {name: /^Keep in glossary: /}).count(), terms);
    const asked = await page.evaluate(() => JSON.parse(c.path.calls[0].request.task.split('\n')[1]));
    assert.equal(asked.operation, 'learn');
    assert.equal(asked.maxRecords, 8);
    assert.match(asked.instructions, /at most eight/);
    report.checks.shortList = true;

    // The reading saved its terms as suggestions. None is used yet.
    const states = () => page.evaluate(async () => (await new SharhTest.Glossary(c.store).list(c.doc.id)).map(r => [r.term, r.status]));
    const before = await states();
    assert.equal(before.length, terms);
    assert.ok(before.every(([, status]) => status === 'suggested'));
    report.checks.suggested = true;

    // Keep one. It says so, and the glossary holds it as the reader's own.
    const first = await card.locator('.finding.term h5').first().textContent();
    await card.getByRole('button', {name: `Keep in glossary: ${first}`, exact: true}).click();
    await card.getByRole('button', {name: `${first} is in your glossary`, exact: true}).waitFor();
    assert.equal(await card.getByRole('button', {name: `${first} is in your glossary`, exact: true}).isDisabled(), true);
    const after = await states();
    assert.equal(after.filter(([, status]) => status === 'kept').length, 1);
    assert.equal(after.filter(([, status]) => status === 'suggested').length, terms - 1);
    report.checks.kept = true;

    // The next reading is told about the kept term and nothing else.
    await root.locator('.follow-ups').getByRole('button', {name: 'Check the argument'}).click();
    await idle(page, 2);
    const sent = await page.evaluate(() => JSON.parse(c.path.calls.at(-1).request.task.split('\n')[1]).glossary?.map(g => g.term));
    assert.deepEqual(sent, [first]);
    report.checks.onlyKeptIsUsed = true;

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    assert.deepEqual(w.errors, []);
    report.passed = true;
  } finally {
    await w.close();
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/readings-terms.json', JSON.stringify(report, null, 2) + '\n');
  }
});
