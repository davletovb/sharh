import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {connectionSteps} from '../src/ui/connection.mjs';
import {languageName,LANGUAGES} from '../src/ui/languages.mjs';

const provider = (label, extra = {}) => ({label, path: 'seatline', provider: label.toLowerCase(), available: true, signedIn: true, accepted: true, capabilities: {toolIsolation: true}, ...extra});
test('setup steps follow the first thing that is missing and never claim later steps early', () => {
  const missing = connectionSteps(['A', 'B'].map(l => provider(l, {error: {reason: 'HOST_NOT_FOUND'}})));
  assert.deepEqual(missing.steps, {install: 'bad', authorize: 'wait', signin: 'wait'});
  assert.equal(missing.connected, false);
  assert.match(missing.next, /Install Seatline/);
  const unauthorized = connectionSteps(['A', 'B'].map(l => provider(l, {error: {reason: 'ORIGIN_NOT_AUTHORIZED'}})));
  assert.deepEqual(unauthorized.steps, {install: 'ok', authorize: 'bad', signin: 'wait'});
  assert.match(unauthorized.next, /authorize command/);
  const signedOut = connectionSteps([provider('A', {signedIn: false, authentication: 'unauthenticated'})]);
  assert.deepEqual(signedOut.steps, {install: 'ok', authorize: 'ok', signin: 'bad'});
  const ready = connectionSteps([provider('A'), provider('B', {signedIn: false})]);
  assert.deepEqual(ready.steps, {install: 'ok', authorize: 'ok', signin: 'ok'});
  assert.equal(ready.connected, true);
  assert.deepEqual(ready.ready.map(p => p.label), ['A']);
});
test('answer languages are named in their own script, and unknown codes show as typed', () => {
  assert.equal(languageName('uz'), 'Oʻzbekcha (Latin)');
  assert.equal(languageName('ru'), 'Русский');
  assert.equal(languageName('uz-Latn'), 'uz-Latn');
  assert.equal(new Set(LANGUAGES.map(([code]) => code)).size, LANGUAGES.length);
});

function page() {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', {pretendToBeVisual: true});
  for (const key of ['document', 'CustomEvent', 'Event', 'KeyboardEvent']) globalThis[key] = dom.window[key];
  return dom;
}
test('a menu opens on click, skips hidden items, disables unavailable ones, and Escape returns focus', async () => {
  const dom = page(), {menuButton} = await import('../extension/ui/components.mjs');
  try {
    const picked = [], menu = menuButton({label: 'More actions', iconName: 'more'});
    document.querySelector('main').append(menu.root);
    menu.setItems([{label: 'One', action: () => picked.push(1)}, '-', {label: 'Hidden', hidden: true, action: () => {}}, {label: 'Off', disabled: true, action: () => picked.push('off')}, {label: 'Two', action: () => picked.push(2)}]);
    const list = menu.root.querySelector('[role=menu]');
    assert.equal(list.hidden, true);
    menu.button.click();
    assert.equal(list.hidden, false);
    assert.equal(menu.button.getAttribute('aria-expanded'), 'true');
    const items = [...list.querySelectorAll('[role=menuitem]')];
    assert.deepEqual(items.map(i => i.textContent), ['One', 'Off', 'Two']);
    assert.equal(items[1].disabled, true);
    assert.equal(document.activeElement, items[0], 'the first available item takes focus');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    assert.equal(document.activeElement, items[2], 'arrow keys skip disabled items');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    assert.equal(list.hidden, true);
    assert.equal(document.activeElement, menu.button);
    menu.button.click();
    list.querySelectorAll('[role=menuitem]')[2].click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(picked, [2]);
    assert.equal(list.hidden, true);
  } finally { dom.window.close(); }
});
test('a chip group marks exactly one choice as pressed', async () => {
  const dom = page(), {chipGroup} = await import('../extension/ui/components.mjs');
  try {
    const seen = [], group = chipGroup({label: 'Lens', choices: [['a', 'A'], ['b', 'B']], onChange: v => seen.push(v)});
    group.select('b');
    assert.deepEqual([...group.buttons.values()].map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
    group.buttons.get('a').click();
    assert.deepEqual(seen, ['a']);
    group.select(null);
    assert.ok([...group.buttons.values()].every(b => b.getAttribute('aria-pressed') === 'false'));
  } finally { dom.window.close(); }
});
