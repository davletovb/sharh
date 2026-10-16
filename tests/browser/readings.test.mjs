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

test('Conversation cards stand alone: plain labels and no repeated table', async () => {
  const w = await setup(), report = {checks: {}}, {page, root} = w;
  try {
    // Themes and citations are cards, not a table plus the same cards again.
    const ideas = await runWay(w, 'Main ideas');
    assert.equal(await ideas.locator('table').count(), 0);
    assert.deepEqual(await ideas.locator('.finding.theme h5').allTextContents(), ['First idea', 'Second idea', 'Third idea']);
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

test('Study it deeply is one request and one composed reading', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  try {
    await root.locator('.goals').getByRole('button', {name: 'Study it deeply'}).click();
    await root.locator('.convo-card').first().waitFor();
    await idle(page, 1);
    // One request, one card: not three consecutive lens readings.
    const calls = await page.evaluate(() => c.path.calls.map(call => { const task = JSON.parse(call.request.task.split('\n')[1]); return {lens: task.lens, operation: task.operation, maxRecords: task.maxRecords, tier: call.request.tier}; }));
    assert.deepEqual(calls, [{lens: 'deep', operation: undefined, maxRecords: 22, tier: 'analysis'}]);
    assert.equal(await root.locator('.convo-card').count(), 1);
    const card = root.locator('.convo-card').first();
    assert.equal(await card.locator('.convo-card-title').textContent(), 'In depth');
    report.checks.oneRequest = true;

    // The reading: a synthesis first, then the outline, the argument, and what is assumed or left open.
    assert.deepEqual(await card.locator('.check-part > h4, .check-part > summary').allTextContents(), ['In short', 'How it is built', 'Main claim', 'Reasons and support', 'Strongest point', 'Weakest link', 'What the text establishes', 'Assumptions and open questions']);
    assert.match(await card.locator('.check-part[data-part="synthesis"] .reading-text').textContent(), /one plain claim/);
    assert.equal(await card.locator('.check-part[data-part="outline"] .finding.sec').count(), 2);
    assert.equal(await card.locator('.check-part[data-part="outline"] .finding.sec .reference').count(), 2);
    assert.equal(await card.locator('svg.analysis-map').count(), 0);
    assert.equal(await card.getByRole('button', {name: 'Show map'}).count(), 0);
    const fold = card.locator('.check-part.record-fold');
    assert.equal(await fold.evaluate(el => el.open), false);
    await fold.locator('summary').click();
    assert.deepEqual(await fold.locator('.finding h5').allTextContents(), ['Assumption', 'Strongest objection', 'Look closer', 'Argue about it']);
    assert.equal(await fold.getByRole('button', {name: /^Show a suggested answer to: /}).count(), 2, 'open questions connect to Ask like any question');
    report.checks.composed = true;

    // Nothing is left empty and no other reading was run behind it.
    assert.deepEqual(await root.locator('.convo-card-title').allTextContents(), ['In depth']);
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
    await writeFile('test-results/readings-deep.json', JSON.stringify(report, null, 2) + '\n');
  }
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

test('Understand and place: a flat outline with paragraph ranges, and Main ideas as a short list', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  const lastCall = () => page.evaluate(() => { const call = c.path.calls.at(-1); return {tier: call.request.tier, task: JSON.parse(call.request.task.split('\n')[1])}; });
  try {
    // The outline is a list, not a map: one range chip a section, nothing to collapse.
    const outline = await runWay(w, 'How it is built');
    assert.equal(await outline.locator('.map-shell').count(), 0);
    assert.equal(await outline.getByRole('button', {name: 'Show map'}).count(), 0);
    assert.equal(await outline.getByRole('button', {name: /Collapse branch|Expand branch/}).count(), 0);
    const sections = await outline.locator('.finding.sec').count();
    assert.ok(sections >= 1);
    assert.equal(await outline.locator('.finding.sec .reference').count(), sections);
    assert.match(await outline.locator('.finding.sec .reference').first().textContent(), /^¶\d+(–\d+)?$/);
    assert.equal(await outline.locator('.inferred-outline').count(), 0, 'this text has headings');
    const asked = await lastCall();
    assert.equal(asked.task.operation, 'outline');
    assert.equal(asked.task.lens, 'structure');
    assert.equal(asked.task.maxRecords, 12);
    assert.match(asked.task.instructions, /at most twelve and never nested/);
    assert.equal(asked.tier, 'quick', 'descriptive help runs on the quick tier');
    report.checks.outline = true;

    // Main ideas are three to five theme records and nothing else.
    const ideas = await runWay(w, 'Main ideas');
    const idea = await lastCall();
    assert.equal(idea.task.lens, 'ideas');
    assert.equal(idea.task.maxRecords, 5);
    assert.match(idea.task.instructions, /three to five ideas/);
    assert.match(idea.task.instructions, /no codes, excerpts, tensions or memos/);
    assert.equal(idea.tier, 'analysis');
    assert.equal(await ideas.locator('.finding.code, .finding.excerpt, .finding.memo').count(), 0);
    report.checks.ideas = true;

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
    await writeFile('test-results/readings-understand.json', JSON.stringify(report, null, 2) + '\n');
  }
});

test('Questions connect to Ask: try an answer, a suggested answer, and asking about a finding', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  const settle = async count => { await page.waitForFunction(n => document.querySelectorAll('#convo-fixture .convo-card').length >= n && !c.workspace.active, count); await page.evaluate(() => c.workspace.view?.settled()); };
  const lastAsk = () => page.evaluate(() => JSON.parse(c.path.calls.at(-1).request.task.split('\n')[1]));
  const chats = () => page.evaluate(async () => (await c.store.all('chats')).map(chat => ({id: chat.id, docId: chat.docId, version: chat.extractionVersion, scopeKey: chat.scopeKey, turns: chat.turns})));
  const runIdOf = lens => page.evaluate(async lens => (await c.store.all('runs')).find(run => run.lens === lens)?.id, lens);
  try {
    // Three to five questions, with no answers given away.
    const quiz = await runWay(w, 'Questions to check yourself');
    const asked = await lastAsk();
    assert.equal(asked.operation, 'quiz');
    assert.equal(asked.lens, 'questions');
    assert.equal(asked.maxRecords, 5);
    assert.match(asked.instructions, /no answers and no hints/);
    const questions = await quiz.locator('.finding.q').count();
    assert.ok(questions >= 3 && questions <= 5);
    assert.equal(await quiz.getByRole('button', {name: /^Show a suggested answer to: /}).count(), questions);
    const quizRun = await runIdOf('questions');
    report.checks.quiz = true;

    // A suggested answer is an Ask turn tied to that question, its reading, text version and scope.
    const second = quiz.locator('.finding.q').nth(1), secondText = await second.locator('.reading-text').textContent();
    await second.getByRole('button', {name: /^Show a suggested answer to: /}).click();
    await settle(2);
    let ask = await lastAsk();
    assert.equal(ask.operation, 'ask');
    assert.ok(ask.question.includes(secondText) && ask.question.includes('suggested answer'));
    assert.match(ask.question, /more than one defensible answer/, 'a question that asks for analysis may have several answers');
    assert.equal(await root.locator('.convo-me').last().textContent(), `Suggested answer to “${secondText.length > 50 ? secondText.slice(0, 49) + '…' : secondText}”`);
    let [chat] = await chats();
    assert.deepEqual(chat.turns[0].about, {runId: quizRun, sequence: chat.turns[0].about.sequence, kind: 'question', text: secondText});
    assert.ok(Number.isSafeInteger(chat.turns[0].about.sequence));
    const doc = await page.evaluate(() => ({id: c.doc.id, version: c.doc.version}));
    assert.equal(chat.docId, doc.id);
    assert.equal(chat.version, doc.version);
    report.checks.suggested = true;

    // Try an answer: the box opens, the button waits for words, and the answer goes with the question.
    const first = quiz.locator('.finding.q').first(), firstText = await first.locator('.reading-text').textContent();
    await first.getByRole('button', {name: /^Try an answer to: /}).click();
    const box = first.getByRole('textbox', {name: /^Your answer to: /}), send = first.getByRole('button', {name: 'Check my answer'});
    assert.equal(await send.isDisabled(), true);
    await box.fill('It claims something plain.');
    assert.equal(await send.isEnabled(), true);
    await send.click();
    await settle(3);
    ask = await lastAsk();
    assert.ok(ask.question.includes(firstText) && ask.question.includes('My answer: It claims something plain.'));
    assert.doesNotMatch(ask.question, /defensible/, 'a question that tests understanding has one answer');
    assert.equal(await box.isVisible(), false);
    [chat] = await chats();
    assert.equal((await chats()).length, 1, 'the same text and scope continue one conversation');
    assert.equal(chat.turns.length, 2);
    assert.equal(chat.turns[1].about.kind, 'question');
    report.checks.tried = true;

    // Any finding can be asked about: the question box says what about, and the turn records it.
    const check = await runWay(w, 'Check the argument'), checkRun = await runIdOf('check');
    await check.getByRole('button', {name: /^Ask about this: The author wants the reader/}).click();
    assert.match(await root.locator('.convo-quote').textContent(), /Asking about\s*Main claim: The author wants the reader/);
    const input = root.getByRole('textbox', {name: 'Ask about this text'});
    await input.fill('Why does the author hold this?');
    await input.press('Enter');
    await settle(5);
    ask = await lastAsk();
    assert.match(ask.question, /^Here is a finding from an earlier reading \(Main claim\): “The author wants the reader to accept the fixture claim\.” Why does the author hold this\?$/);
    assert.equal(await root.locator('.convo-me').last().textContent(), 'Why does the author hold this?');
    await root.locator('.convo-quote').waitFor({state: 'hidden'});
    [chat] = await chats();
    const turn = chat.turns.at(-1);
    assert.equal(turn.about.kind, 'finding');
    assert.equal(turn.about.runId, checkRun);
    assert.equal(turn.label, 'Why does the author hold this?');
    report.checks.finding = true;

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
    await writeFile('test-results/readings-ask.json', JSON.stringify(report, null, 2) + '\n');
  }
});

test('Selection actions: Argument is a few short parts, Define can be kept, and an old Logic request reads as Argument', async () => {
  const w = await setup(), {page, root} = w, report = {checks: {}};
  const settle = async count => { await page.waitForFunction(n => document.querySelectorAll('#convo-fixture .convo-card').length >= n && !c.workspace.active, count); await page.evaluate(() => c.workspace.view?.settled()); };
  const lastCall = () => page.evaluate(() => { const call = c.path.calls.at(-1); return {tier: call.request.tier, task: JSON.parse(call.request.task.split('\n')[1])}; });
  const select = {spans: [{n: 5, start: 0, end: 8}]};
  try {
    await page.evaluate(sel => c.workspace.passage('Argument', sel), select);
    await settle(1);
    const argument = root.locator('.convo-card').first();
    const asked = await lastCall();
    assert.equal(asked.task.action, 'Argument');
    assert.equal(asked.task.lens, 'check');
    assert.equal(asked.task.maxRecords, 4);
    assert.equal(asked.tier, 'quick', 'selection actions run on the quick tier');
    assert.match(asked.task.instructions, /what the selected lines do/);
    assert.match(await argument.locator('.convo-card-title').textContent(), /^Argument · /);
    assert.deepEqual(await argument.locator('.check-part > h4').allTextContents(), ['What these lines do', 'How they connect', 'A weakness here']);
    assert.equal(await argument.locator('svg.analysis-map').count(), 0);
    assert.equal(await argument.getByRole('button', {name: 'Show map'}).count(), 0);
    assert.ok(await argument.getByRole('button', {name: /^Ask about this: /}).count());
    report.checks.argument = true;

    // An open page that still has the older toolbar sends Logic. It is read as Argument.
    await page.evaluate(sel => c.workspace.passage('Logic', sel), select);
    await settle(2);
    const old = await lastCall();
    assert.equal(old.task.action, 'Argument');
    assert.equal(old.task.lens, 'check');
    report.checks.logicReadAsArgument = true;

    // Define is one term that can be kept in the glossary.
    await page.evaluate(sel => c.workspace.passage('Define', sel), select);
    await settle(3);
    const define = root.locator('.convo-card').nth(2);
    assert.equal(await define.locator('.finding.term').count(), 1);
    const keep = define.getByRole('button', {name: /^Keep in glossary: /});
    await keep.click();
    await define.getByRole('button', {name: /is in your glossary$/}).waitFor();
    const kept = await page.evaluate(async () => (await new SharhTest.Glossary(c.store).list(c.doc.id)).filter(r => r.status === 'kept').length);
    assert.equal(kept, 1);
    report.checks.defineKept = true;

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
    await writeFile('test-results/readings-selection.json', JSON.stringify(report, null, 2) + '\n');
  }
});
