import {Readability} from '@mozilla/readability';
import {EXTRACTOR_VERSION, normalizeText, makeSections, versionOf} from '../documents/model.mjs';
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
  const sourceElements = [document.body,...document.body.querySelectorAll('*')], copied = [clone.body,...clone.body.querySelectorAll('*')];
  copied.forEach((el, i) => { const marker = prefix + i; el.classList.add(marker); originals.set(marker, sourceElements[i]); });
  // An explicit solitary long article is the main source; outside teasers are not its paragraphs.
  const articles = [...clone.body.querySelectorAll('article')].filter(el => !el.closest('nav,aside,footer,[hidden]') && normalizeText(el.textContent).length >= 250);
  if (articles.length === 1) clone.body.replaceChildren(articles[0]);
  const article = new Readability(clone, {keepClasses: true, serializer: el => el}).parse();
  if (!article) throw new Error('READABILITY_NO_ARTICLE');
  const runs = collectRuns(article.content).map(run => {
    let source;
    for (let el = run.element; el && !source; el = el.parentElement) for (const name of el.classList) if (originals.has(name)) { source = originals.get(name); break; }
    return {...run, source:source || document.body};
  });
  // Readability removes the article's title heading. Restore only its own source H1.
  const first = runs[0]?.source, container = first?.closest('article,main') ?? first?.parentElement;
  const title = container && [...container.querySelectorAll('h1')].find(h => normalizeText(h.textContent) === normalizeText(article.title) || textMap(h).text===normalizeText(article.title));
  if (title && !runs.some(r => r.source === title)) runs.unshift({element: title, source: title, raw: textMap(title).text});
  return runs;
}
export async function extractHTML(document, {mode = 'article', region = null, identity = document.URL} = {}) {
  let runs;const warnings=[];
  if (mode === 'article') {
    try { runs=articleRuns(document); }
    catch { runs=collectRuns(document.body).map(r=>({...r,source:r.element}));warnings.push({cause:'no-main-article',detail:'Used whole-page extraction.'}); }
  }
  else {
    const root = mode === 'whole' ? document.body : mode === 'region' ? document.querySelector(region) : null;
    if (!root) throw new Error(mode === 'region' ? 'REGION_NOT_FOUND' : 'UNKNOWN_EXTRACTION_MODE');
    runs = collectRuns(root).map(r => ({...r, source: r.element}));
  }
  const body = textMap(document.body), paths = pathsFor(document), localMaps = new Map([[document.body,body]]), cursors = new Map(), blocks = [];
  for (const run of runs) {
    let text = normalizeText(run.raw);const el = run.source;
    if(!text)continue;
    let local = localMaps.get(el); if (!local) { local = textMap(el); localMaps.set(el, local); }
    let start = local.text.indexOf(text, cursors.get(el) ?? 0);
    if (start < 0) {
      const candidates=collectRuns(el).map(r=>normalizeText(r.raw)).filter(Boolean);
      const recovered=candidates.find(candidate=>candidate.includes(text.slice(0,Math.min(24,text.length)))) || (candidates.length===1?candidates[0]:null);
      if(recovered){text=recovered;start=local.text.indexOf(text,cursors.get(el)??0);}
      warnings.push({cause:start<0?'unmapped-block-skipped':'source-text-recovered'});
      if(start<0)continue;
    }
    const range = local.range(start, start + text.length), position = body.position(range);
    cursors.set(el, start + text.length);
    const tag=run.element.tagName,heading = /^H[1-6]$/.test(tag);
    blocks.push({n: blocks.length + 1, kind: heading ? 'heading' : tag === 'BLOCKQUOTE' ? 'quote' : tag === 'LI' ? 'list' : tag === 'TABLE' ? 'table' : tag === 'FIGCAPTION' ? 'caption' : 'para',
      ...(heading ? {level: Number(tag[1])} : {}), text, anchor: {type: 'html', path: paths.get(el), textVersion:body.signature, quote: {exact: text, prefix: body.text.slice(Math.max(0, position.start - 64), position.start), suffix: body.text.slice(position.end, position.end + 64)}, position}});
  }
  if (!blocks.length) {
    if(mode==='article') {const fallback=await extractHTML(document,{mode:'whole',identity});fallback.warnings.unshift({cause:'article-mapping-fallback'});return fallback;}
    throw new Error('NO_TEXT_BLOCKS');
  }
  const sections = makeSections(blocks);
  return {title: document.title, language: document.documentElement.lang || null, mode, region, extractorVersion: EXTRACTOR_VERSION,
    version: await versionOf(identity, JSON.stringify({mode, region, title:document.title, language:document.documentElement.lang,
      blocks:blocks.map(({kind,level,text}) => ({kind,level,text}))})), blocks, sections, warnings};
}
export function resolveHTMLAnchor(document, anchor, {body=textMap(document.body),window}={}) {
  if (anchor.type !== 'html' || !anchor.quote?.exact) return null;
  const exact = anchor.quote.exact, matches = [];
  let match;
  if(anchor.textVersion===body.signature && body.text.slice(anchor.position?.start,anchor.position?.end)===exact)match=anchor.position;
  if(!match) {
  for (let start = body.text.indexOf(exact); start >= 0; start = body.text.indexOf(exact, start + 1)) {
    const end = start + exact.length;
    const prefix = !anchor.quote.prefix || body.text.endsWith(anchor.quote.prefix, start);
    const suffix = !anchor.quote.suffix || body.text.startsWith(anchor.quote.suffix, end);
    matches.push({start, end, score: Number(prefix) + Number(suffix)});
  }
  if (!matches.length) return null;
  const highest = Math.max(...matches.map(m => m.score)), contextual = matches.filter(m => m.score === highest);
  match = matches.length === 1 ? matches[0] : highest > 0 && contextual.length === 1 ? contextual[0] : null;
  }
  if (!match) return null; // Ambiguous duplicates are never resolved by an obsolete DOM path alone.
  if(window && (match.end<=window.start || match.start>=window.end))return null;
  match={...match,range:body.range(match.start,match.end)};
  let pathElement;
  try { pathElement = document.querySelector(anchor.path); } catch { /* Invalid path: use the quote. */ }
  const pathMatches = pathElement?.contains(match.range.startContainer) && pathElement?.contains(match.range.endContainer);
  const common = match.range.commonAncestorContainer;
  return {text: body.text.slice(match.start, match.end),start:match.start,end:match.end, element: pathMatches ? pathElement : common.nodeType === 1 ? common : common.parentElement, range: match.range, strategy: pathMatches ? 'path' : 'quote'};
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
export function selectedHTMLBlocks(document, blocks) {
  const selection = document.defaultView.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0), spans = [], body = textMap(document.body);
  const selected=body.position(range), unchanged=blocks[0]?.anchor.textVersion===body.signature;
  for (const block of blocks) {
    const pos=block.anchor.position;
    if(unchanged && (pos.end<=selected.start || pos.start>=selected.end))continue;
    const hit = resolveHTMLAnchor(document, block.anchor,{body,window:selected});
    if (!hit) continue;
    const start = Math.max(selected.start,hit.start)-hit.start, end = Math.min(selected.end,hit.end)-hit.start;
    if (end > start && start >= 0 && end <= block.text.length) spans.push({n:block.n, start, end});
  }
  return spans.length ? {spans, text:normalizeText(selection.toString())} : null;
}
