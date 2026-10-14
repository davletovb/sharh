import {Readability} from '@mozilla/readability';
import {EXTRACTOR_VERSION, normalizeText, makeSections, versionOf} from './document.mjs';
const selector = 'h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,figcaption,table';
function elements(root) {
  return [...root.querySelectorAll(selector)].filter(el => !el.closest('script,style,nav,footer,aside,[hidden],[aria-hidden="true"]') &&
    !el.querySelector(selector) && normalizeText(el.textContent));
}
function pathOf(el) {
  const parts = [];
  for (; el && el.nodeType === 1; el = el.parentElement) {
    const siblings = el.parentElement ? [...el.parentElement.children].filter(s => s.tagName === el.tagName) : [el];
    parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`);
  }
  return parts.join(' > ');
}
export async function extractHTML(document, {mode = 'article', region = null} = {}) {
  let root = document.body, warning = null;
  if (mode === 'article') {
    const article = new Readability(document.cloneNode(true)).parse();
    if (!article) throw new Error('READABILITY_NO_ARTICLE');
    const parsed = new DOMParser().parseFromString(article.content, 'text/html');
    const retained = elements(parsed.body).map(el => normalizeText(el.textContent));
    // Retain references to the live DOM; Readability operates only on a clone.
    const candidates = elements(document.body);
    root = {querySelectorAll: () => candidates.filter(el => retained.includes(normalizeText(el.textContent)) || (el.tagName === 'H1' && normalizeText(el.textContent) === normalizeText(article.title)))};
  } else if (mode === 'region') {
    root = document.querySelector(region); if (!root) throw new Error('REGION_NOT_FOUND');
  } else if (mode !== 'whole') throw new Error('UNKNOWN_EXTRACTION_MODE');
  const nodes = elements(root), texts = nodes.map(el => normalizeText(el.textContent));
  const blocks = nodes.map((el, i) => ({n: i + 1, kind: /^H[1-6]$/.test(el.tagName) ? 'heading' : el.tagName === 'BLOCKQUOTE' ? 'quote' : el.tagName === 'LI' ? 'list' : el.tagName === 'TABLE' ? 'table' : el.tagName === 'FIGCAPTION' ? 'caption' : 'para',
    ...(/^H/.test(el.tagName) ? {level: Number(el.tagName[1])} : {}), text: texts[i], anchor: {type: 'html', path: pathOf(el),
      quote: {exact: texts[i], prefix: texts.slice(Math.max(0, i - 1), i).join(' ').slice(-64), suffix: texts[i + 1]?.slice(0, 64) ?? ''},
      position: {start: texts.slice(0, i).join(' ').length + (i ? 1 : 0), end: texts.slice(0, i + 1).join(' ').length}}}));
  if (!blocks.length) throw new Error('NO_TEXT_BLOCKS');
  return {title: document.title, language: document.documentElement.lang || null, extractorVersion: EXTRACTOR_VERSION,
    version: await versionOf(document.URL, blocks.map(b => b.text).join('\n')), blocks, sections: makeSections(blocks), warning};
}
export function resolveHTMLAnchor(document, anchor) {
  if (anchor.type !== 'html') return null;
  const exact = anchor.quote.exact;
  let el;
  try { el = document.querySelector(anchor.path); } catch { /* Try the quote when a path is stale. */ }
  if (el && normalizeText(el.textContent) === exact) return {element: el, range: rangeFor(document, el), strategy: 'path'};
  const all = elements(document.body), matches = all.filter(e => normalizeText(e.textContent) === exact);
  if (matches.length === 1) el = matches[0];
  else {
    const contextual = matches.filter(e => {
      const i = all.indexOf(e);
      return (!anchor.quote.prefix || normalizeText(all[i - 1]?.textContent ?? '').endsWith(anchor.quote.prefix)) &&
        (!anchor.quote.suffix || normalizeText(all[i + 1]?.textContent ?? '').startsWith(anchor.quote.suffix));
    });
    if (contextual.length !== 1) return null;
    el = contextual[0];
  }
  return el ? {element: el, range: rangeFor(document, el), strategy: 'quote'} : null;
}
function rangeFor(document, el) { const range = document.createRange(); range.selectNodeContents(el); return range; }
export function highlightHTML(document, anchor) {
  const resolved = resolveHTMLAnchor(document, anchor);
  const view = document.defaultView;
  if (!resolved || !view.CSS?.highlights || !view.Highlight) return null;
  view.CSS.highlights.set('sharh-reference', new view.Highlight(resolved.range));
  resolved.element.scrollIntoView({block: 'center'});
  return {strategy: resolved.strategy, text: normalizeText(resolved.range.toString()), rects: [...resolved.range.getClientRects()].map(r => ({x: r.x, y: r.y, width: r.width, height: r.height}))};
}
