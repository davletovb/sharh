import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const id = 'npmhefooiolfpmhicinblelaideeejcm', base = `chrome-extension://${id}`;

async function setup({signedIn = true} = {}) {
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
      return {text: ['summary', 'structure', 'logic', 'thinking'].includes(task.lens) ? phaseOneOutput(task, source) : phaseTwoOutput(task, source)};
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
async function axe(page) {
  const cdp = await page.context().newCDPSession(page);
  try { await cdp.send('Runtime.evaluate', {expression: await readFile('node_modules/axe-core/axe.min.js', 'utf8')}); } finally { await cdp.detach(); }
  return page.evaluate(async () => (await window.axe.run(document.querySelector('#convo-fixture'), {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}})).violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)})));
}
const idle = async (page, count) => { await page.waitForFunction(count => c.path.calls.length >= count && !c.workspace.active, count); await page.evaluate(() => c.workspace.view?.settled()); };

test('Conversation: the four goals, follow-ups, Ask and a clean screen', async () => {
  const w = await setup(), report = {checks: {}};
  try {
    const {root, page} = w;
    // First sight: a title, one sentence, four goals and one input. Nothing about models, tokens or tabs.
    await root.getByText('I’ve read this text. What would you like to know?').waitFor();
    const goals = root.getByRole('group', {name: 'Ways to read'});
    assert.deepEqual(await goals.getByRole('button').allTextContents(), ['Get the gist', 'Check the argument', 'Learn the terms', 'Study it deeply']);
    assert.equal(await root.getByRole('textbox', {name: 'Ask about this text'}).isVisible(), true);
    for (const hidden of ['.workspace-nav', '.adjust', '.scope-estimate', '.doc-chips', '.lens-bar']) assert.equal(await root.locator(hidden).first().isVisible(), false, hidden);
    assert.equal(await root.locator('.convo-strip').isVisible(), false);
    report.checks.cleanFirstScreen = true;

    // A goal: the question appears as a bubble, the answer as a card with a plain title.
    await goals.getByRole('button', {name: 'Get the gist'}).click();
    await root.locator('.convo-card').first().waitFor();
    await idle(page, 1);
    assert.equal(await root.locator('.convo-me').first().textContent(), 'Get the gist');
    assert.equal(await root.locator('.convo-card-title').first().textContent(), 'The gist');
    // The gist is the point and the abstract, nothing more: no sections, brief or arc.
    assert.equal(await root.locator('.convo-card .finding').count(), 2);
    assert.deepEqual(await root.locator('.convo-card .finding.sum').evaluateAll(cards => cards.map(c => c.dataset.level)), ['line', 'abstract']);
    assert.equal(await root.locator('.convo-card .finding.arc').count(), 0);
    assert.equal(await goals.isVisible(), false);
    assert.deepEqual(await root.locator('.follow-ups button').allTextContents(), ['Check the argument', 'Learn the terms']);
    await root.locator('.card-details summary').first().click();
    assert.match(await root.locator('.card-meta').first().textContent(), /fixture/);
    report.checks.goalAndFollowUps = true;

    // A follow-up chip adds a second card and keeps the first.
    await root.locator('.follow-ups').getByRole('button', {name: 'Check the argument'}).click();
    await page.waitForFunction(() => document.querySelectorAll('#convo-fixture .convo-card').length === 2);
    await idle(page, 2);
    assert.deepEqual(await root.locator('.convo-card-title').allTextContents(), ['The gist', 'The argument']);
    report.checks.twoCards = true;

    // Ask is the same box. Answers are cards with real reference buttons and no live markup.
    const input = root.getByRole('textbox', {name: 'Ask about this text'});
    await input.fill('What is the claim?');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#convo-fixture').textContent.includes('Grounded answer'));
    await idle(page, 3);
    assert.equal(await root.locator('.convo-me').last().textContent(), 'What is the claim?');
    assert.equal(await root.locator('.convo-card').last().locator('svg').count(), 0);
    assert.ok(await root.locator('.convo-card').last().locator('.reference').count());
    assert.equal(await input.inputValue(), '');
    report.checks.ask = true;

    // The header menu offers earlier readings and exports; nothing else is on screen.
    const labels = await page.evaluate(() => c.workspace.menuItems().filter(i => i !== '-' && !i.hidden).map(i => i.label));
    assert.ok(labels.some(l => l.startsWith('Earlier: The gist')));
    assert.ok(labels.includes('Export as Markdown'));
    report.checks.menu = true;

    // More ways to read lists the rest in plain words.
    await root.getByRole('button', {name: 'More ways to read'}).click();
    for (const name of ['How it is built', 'How it thinks', 'Themes', 'What kind of text this is', 'Strengths and weak points', 'Who it cites', 'Questions to check yourself']) await root.getByRole('menuitem', {name, exact: true}).waitFor();
    await page.keyboard.press('Escape');
    report.checks.moreWays = true;
    assert.deepEqual(w.errors, []);

    for (const scheme of ['light', 'dark']) {
      // Reduced motion stops colour transitions, so axe never measures a half-way colour.
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    report.checks.accessibility = true;
    report.passed = true;
  } finally {
    await w.close();
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/conversation.json', JSON.stringify(report, null, 2) + '\n');
  }
});

test('Conversation: with no usable model the screen says so once and offers the fix', async () => {
  const w = await setup({signedIn: false});
  try {
    const {root} = w;
    await root.locator('.convo-strip[data-tone="problem"]').waitFor();
    assert.match(await root.locator('.strip-notice').textContent(), /No model is set up yet/);
    assert.equal(await root.getByRole('button', {name: 'Choose a model'}).isVisible(), true);
    for (const b of await root.getByRole('group', {name: 'Ways to read'}).getByRole('button').all()) assert.equal(await b.isDisabled(), true);
    // A refused request leaves no dangling question behind.
    await root.getByRole('textbox', {name: 'Ask about this text'}).fill('Anything?');
    await root.getByRole('textbox', {name: 'Ask about this text'}).press('Enter');
    await w.page.waitForTimeout(500);
    assert.equal(await root.locator('.convo-me').count(), 0);
  } finally { await w.close(); }
});

test('Ask page: saved conversations, the open one in full, and back to the reading', async () => {
  const w = await setup(), report = {checks: {}};
  try {
    const {root, page} = w;
    const input = root.getByRole('textbox', {name: 'Ask about this text'});
    await input.fill('What is the claim?');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#convo-fixture').textContent.includes('Grounded answer'));
    await idle(page, 1);

    // The header menu opens the page; the conversation just had is already there.
    await page.evaluate(() => c.workspace.menuItems().find(i => i.label === 'Conversations').action());
    await root.getByRole('heading', {name: 'Conversations', level: 2}).waitFor();
    assert.equal(await root.locator('.convo-stream').isVisible(), false);
    await root.locator('.chat-turn').first().waitFor();
    assert.match(await root.locator('.chat-transcript').textContent(), /What is the claim\?/);
    assert.equal(await root.getByRole('button', {name: /Open conversation: What is the claim/}).getAttribute('aria-pressed'), 'true');
    report.checks.opensWithTheConversation = true;

    // Ask again on the page, then start a new conversation and come back to the first.
    await root.getByLabel('Question', {exact: true}).fill('What supports it?');
    await root.getByRole('button', {name: 'Send question', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('#convo-fixture .chat-turn').length === 2);
    await idle(page, 2);
    await root.getByRole('button', {name: 'New conversation', exact: true}).click();
    assert.equal(await root.locator('.chat-turn').count(), 0);
    await root.getByRole('button', {name: /Open conversation: What is the claim/}).click();
    await page.waitForFunction(() => document.querySelectorAll('#convo-fixture .chat-turn').length === 2);
    assert.equal(await root.locator('.chat-turn svg').count(), 0);
    report.checks.switchesConversations = true;

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
      await page.waitForTimeout(150);
      assert.deepEqual(await axe(page), [], scheme);
    }
    report.checks.accessibility = true;

    await root.getByRole('button', {name: '← Back to the reading'}).first().click();
    await root.locator('.convo-stream').waitFor();
    // Asking from the reading goes back to the shared stream and does not open the page.
    await input.fill('And the evidence?');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#convo-fixture .convo-card').length >= 1 && document.querySelector('#convo-fixture').textContent.includes('And the evidence?'));
    assert.equal(await root.locator('.convo-stream').isVisible(), true);
    report.checks.backToStream = true;
    assert.deepEqual(w.errors, []);
    report.passed = true;
  } finally {
    await w.close();
    await mkdir('test-results', {recursive: true});
    await writeFile('test-results/ask-page.json', JSON.stringify(report, null, 2) + '\n');
  }
});
