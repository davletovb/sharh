import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TOOLBAR_CSS} from '../extension/ui/passage-toolbar.mjs';
const lum = h => {const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];};
const ratio = (a, b) => {const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05);};
const tokens = block => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
const PAIRS = [['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['on-gold', 'gold'], ['link', 'surface'], ['gold', 'bg'], ['gold', 'surface'], ['lapis', 'surface'], ['ok', 'surface'], ['warn', 'surface'], ['bad', 'surface']];
const NON_TEXT = [['line-strong', 'surface'], ['focus', 'surface']];
test('the shipped colour tokens meet WCAG AA for text and 3:1 for borders and focus in both themes', async () => {
  const css = await readFile('extension/ui/style.css', 'utf8');
  const light = tokens(css.match(/:root\s*\{[\s\S]*?\n\}/)[0]), dark = tokens(css.match(/:root\[data-theme='ink'\]\s*\{[\s\S]*?\n\s*\}/)[0]);
  for (const [name, set] of [['parchment', light], ['ink', dark]]) {
    for (const [a, b] of PAIRS) assert.ok(set[a] && set[b] && ratio(set[a], set[b]) >= 4.5, `${name}: ${a} on ${b} is ${set[a] && set[b] && ratio(set[a], set[b]).toFixed(2)}`);
    for (const [a, b] of NON_TEXT) assert.ok(ratio(set[a], set[b]) >= 3, `${name}: ${a} on ${b}`);
  }
});
test('the selection toolbar keeps AA contrast in both of its own themes', () => {
  const [light, dark] = [...TOOLBAR_CSS.matchAll(/--bg:[^}]*?;\s*(?=\}|\n|$)/g)].map(m => tokens(m[0]));
  assert.ok(light && dark);
  for (const set of [light, dark]) for (const [a, b] of [['text', 'bg'], ['muted', 'bg'], ['on-gold', 'gold'], ['gold', 'bg'], ['text', 'chip']]) assert.ok(ratio(set[a], set[b]) >= 4.5, `${a} on ${b}: ${ratio(set[a], set[b]).toFixed(2)}`);
});
