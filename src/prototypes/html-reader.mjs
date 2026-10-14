import {Readability} from '@mozilla/readability';
import {EXTRACTOR_VERSION, normalizeText, makeSections, versionOf} from './document.mjs';
import {collectRuns, textMap} from './html-text.mjs';
const styledDocuments = new WeakSet();
function pathsFor(document) {
  const paths = new Map();
  function visit(el, path) {
    paths.set(el, path); const counts = new Map();
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase(), n = (counts.get(tag) ?? 0) + 1; counts.set(tag, n);
      visit(child, `${path} > ${tag}:nth-of-type(${n})`);
    }
  }
  visit(document.documentElement, 'html:nth-of-type(1)'); return paths;
}
function articleRuns(document) {
  const clone = document.cloneNode(true), prefix = `sharh-source-${Math.random().toString(36).slice(2)}-`, originals = new Map();
  const sourceElements = [...document.body.querySelectorAll('*')], copied = [...clone.body.querySelectorAll('*')];
  copied.forEach((el, i) => { const marker = prefix + i; el.classList.add(marker); originals.set(marker, sourceElements[i]); });
  const article = new Readability(clone, {keepClasses: true, serializer: el => el}).parse();
  if (!article) throw new Error('READABILITY_NO_ARTICLE');
  const runs = collectRuns(article.content).map(run => {
    let source;
    for (let el = run.element; el && !source; el = el.parentElement) for (const name of el.classList) if (originals.has(name)) { source = originals.get(name); break; }
    if (!source) throw new Error('READABILITY_SOURCE_MAPPING_FAILED');
    return {...run, source};
  });
  // Readability removes the article's title heading. Restore only its own source H1.
  const first = runs[0]?.source, container = first?.closest('article,main') ?? first?.parentElement;
  const title = container && [...container.querySelectorAll('h1')].find(h => normalizeText(h.textContent) === normalizeText(article.title));
  if (title && !runs.some(r => r.source === title)) runs.unshift({element: title, source: title, raw: title.textContent});
  return runs;
}
export async function extractHTML(document, {mode = 'article', region = null, identity = document.URL} = {}) {
  let runs;
  if (mode === 'article') runs = articleRuns(document);
  else {
    const root = mode === 'whole' ? document.body : mode === 'region' ? document.querySelector(region) : null;
    if (!root) throw new Error(mode === 'region' ? 'REGION_NOT_FOUND' : 'UNKNOWN_EXTRACTION_MODE');
    runs = collectRuns(root).map(r => ({...r, source: r.element}));
  }
  const body = textMap(document.body), paths = pathsFor(document), localMaps = new Map(), cursors = new Map(), blocks = [];
  for (const run of runs) {
    const text = normalizeText(run.raw), el = run.source;
    let local = localMaps.get(el); if (!local) { local = textMap(el); localMaps.set(el, local); }
    const start = local.text.indexOf(text, cursors.get(el) ?? 0);
    if (start < 0) throw new Error('READABILITY_TEXT_MAPPING_FAILED');
    const range = local.range(start, start + text.length), position = body.position(range);
    cursors.set(el, start + text.length);
    const heading = /^H[1-6]$/.test(el.tagName);
    blocks.push({n: blocks.length + 1, kind: heading ? 'heading' : el.tagName === 'BLOCKQUOTE' ? 'quote' : el.tagName === 'LI' ? 'list' : el.tagName === 'TABLE' ? 'table' : el.tagName === 'FIGCAPTION' ? 'caption' : 'para',
      ...(heading ? {level: Number(el.tagName[1])} : {}), text, anchor: {type: 'html', path: paths.get(el), quote: {exact: text, prefix: body.text.slice(Math.max(0, position.start - 64), position.start), suffix: body.text.slice(position.end, position.end + 64)}, position}});
  }
  if (!blocks.length) throw new Error('NO_TEXT_BLOCKS');
  return {title: document.title, language: document.documentElement.lang || null, extractorVersion: EXTRACTOR_VERSION,
    version: await versionOf(identity, JSON.stringify(blocks.map(({kind, level, text}) => ({kind, level, text})))), blocks, sections: makeSections(blocks), warning: null};
}
export function resolveHTMLAnchor(document, anchor) {
  if (anchor.type !== 'html' || !anchor.quote?.exact) return null;
  const body = textMap(document.body), exact = anchor.quote.exact, matches = [];
  for (let start = body.text.indexOf(exact); start >= 0; start = body.text.indexOf(exact, start + 1)) {
    const end = start + exact.length, range = body.range(start, end);
    const prefix = !anchor.quote.prefix || body.text.endsWith(anchor.quote.prefix, start);
    const suffix = !anchor.quote.suffix || body.text.startsWith(anchor.quote.suffix, end);
    matches.push({range, start, end, score: Number(prefix) + Number(suffix)});
  }
  if (!matches.length) return null;
  const highest = Math.max(...matches.map(m => m.score)), contextual = matches.filter(m => m.score === highest);
  const match = matches.length === 1 ? matches[0] : highest > 0 && contextual.length === 1 ? contextual[0] : null;
  if (!match) return null; // Ambiguous duplicates are never resolved by an obsolete DOM path alone.
  let pathElement;
  try { pathElement = document.querySelector(anchor.path); } catch { /* Invalid path: use the quote. */ }
  const pathMatches = pathElement?.contains(match.range.startContainer) && pathElement?.contains(match.range.endContainer);
  const common = match.range.commonAncestorContainer;
  return {text: body.text.slice(match.start, match.end), element: pathMatches ? pathElement : common.nodeType === 1 ? common : common.parentElement, range: match.range, strategy: pathMatches ? 'path' : 'quote'};
}
export function highlightHTML(document, anchor) {
  const resolved = resolveHTMLAnchor(document, anchor), view = document.defaultView;
  if (!resolved || !view.CSS?.highlights || !view.Highlight) return null;
  if (!styledDocuments.has(document)) {
    const sheet = new view.CSSStyleSheet(); sheet.replaceSync('::highlight(sharh-reference) { background-color: #f3c969; color: #16171c; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; styledDocuments.add(document);
  }
  view.CSS.highlights.set('sharh-reference', new view.Highlight(resolved.range)); resolved.element.scrollIntoView({block: 'center'});
  return {strategy: resolved.strategy, text: resolved.text, rects: [...resolved.range.getClientRects()].map(r => ({x: r.x, y: r.y, width: r.width, height: r.height}))};
}
