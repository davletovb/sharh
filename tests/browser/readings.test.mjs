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
    // A map opens only when asked for, and a relation names the two findings it joins.
    const thinking = await runWay(w, 'How it thinks'), toggle = thinking.getByRole('button', {name: 'Show map'});
    assert.equal(await thinking.locator('.map-shell').isVisible(), false);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await thinking.getByRole('button', {name: 'Zoom in'}).count(), 0, 'no map controls until the map is shown');
    assert.match(await thinking.locator('.finding.edge p').first().textContent(), /Deterministic fixture.*→.*Deterministic fixture/);
    assert.match(await thinking.locator('.basis').first().textContent(), /^(Stated in the text|Inferred)$/);
    await toggle.click();
    assert.equal(await thinking.locator('.map-shell').isVisible(), true);
    assert.equal(await thinking.getByRole('button', {name: 'Hide map'}).getAttribute('aria-expanded'), 'true');
    await thinking.getByRole('button', {name: 'Hide map'}).click();
    assert.equal(await thinking.locator('.map-shell').isVisible(), false);
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

test('Check the argument: claim, reasons, strongest and weakest point, and what the text establishes', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  try {
    await root.locator('.goals').getByRole('button', {name: 'Check the argument'}).click();
    await root.locator('.convo-card').first().waitFor();
    await idle(page, 1);
    const card = root.locator('.convo-card').first();
    assert.equal(await card.locator('.convo-card-title').textContent(), 'The argument');

    // It asks for ten records on the Check lens, with the text-only assessment rule.
    const asked = await page.evaluate(() => JSON.parse(c.path.calls[0].request.task.split('\n')[1]));
    assert.equal(asked.lens, 'check');
    assert.equal(asked.maxRecords, 10);
    assert.match(asked.instructions, /not a check of the facts/);

    // The answer reads top to bottom in a fixed order, and has no map to open.
    assert.deepEqual(await card.locator('.check-part:not(.record-fold) > h4').allTextContents(), ['Main claim', 'Reasons and support', 'Strongest point', 'Weakest link', 'What the text establishes']);
    assert.equal(await card.locator('.check-part[data-part="reason"] .finding').count(), 2);
    assert.equal(await card.locator('svg.analysis-map').count(), 0);
    assert.equal(await card.getByRole('button', {name: 'Show map'}).count(), 0);
    assert.match(await card.locator('.check-part[data-part="claim"] .reading-text').textContent(), /The author wants the reader to accept/);
    assert.ok(await card.locator('.check-part .reference').count(), 'every part keeps its paragraph references');
    assert.ok((await card.locator('.basis').allTextContents()).every(text => ['Stated in the text', 'Inferred'].includes(text)));
    report.checks.answerInOrder = true;

    // Assumptions and the strongest objection are underneath, folded.
    const fold = card.locator('.check-part.record-fold');
    assert.equal(await fold.evaluate(el => el.open), false);
    assert.equal(await fold.locator('summary').textContent(), 'Assumptions and the strongest objection');
    await fold.locator('summary').click();
    assert.deepEqual(await fold.locator('.finding h5').allTextContents(), ['Assumption', 'Strongest objection']);
    report.checks.assumptionsFolded = true;

    // The detailed lenses are still there for Studio; the conversation menu no longer lists Critique.
    await root.getByRole('button', {name: 'More ways to read'}).click();
    assert.equal(await root.getByRole('menuitem', {name: 'Strengths and weak points', exact: true}).count(), 0);
    await root.getByRole('menuitem', {name: 'Check the argument', exact: true}).waitFor();
    await page.keyboard.press('Escape');
    report.checks.menu = true;

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
    await writeFile('test-results/readings-check.json', JSON.stringify(report, null, 2) + '\n');
  }
});
