import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {EXTRACTOR_VERSION, normalizeText, makeSections, versionOf} from './document.mjs';
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
export async function openPDF(data) {
  return getDocument({data: new Uint8Array(data), isEvalSupported: false, standardFontDataUrl: '/standard_fonts/', useSystemFonts: true}).promise;
}
export async function extractPDF(pdf, identity = 'local-pdf') {
  const pages = [], labels = await pdf.getPageLabels();
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1), content = await page.getTextContent(), viewport = page.getViewport({scale: 1});
    pages.push({index, height: viewport.height, width: viewport.width, items: content.items.map((item, i) => ({...item, index: i, x: item.transform?.[4], y: item.transform?.[5], size: Math.abs(item.transform?.[3] ?? 0)})).filter(item => item.str?.trim())});
  }
  const repeated = new Map();
  for (const page of pages) for (const text of new Set(page.items.filter(i => i.y < 35 || i.y > page.height - 35).map(i => normalizeText(i.str)))) repeated.set(text, (repeated.get(text) ?? 0) + 1);
  const blocks = [], removed = [];
  for (const page of pages) {
    const items = page.items.filter(item => {
      const margin = item.y < 35 || item.y > page.height - 35;
      if (margin && ((repeated.get(normalizeText(item.str)) ?? 0) > 1 || /^\d+$/.test(item.str))) { removed.push({page: page.index, text: item.str, cause: 'running-margin'}); return false; }
      return true;
    });
    const heading = items.filter(i => i.size >= 16), notes = items.filter(i => i.size < 10 && i.y < page.height * .25);
    const body = items.filter(i => !heading.includes(i) && !notes.includes(i));
    const twoColumns = body.some(i => i.x > page.width / 2) && body.some(i => i.x < page.width / 3);
    const groups = [heading, ...(twoColumns ? [body.filter(i => i.x < page.width / 2), body.filter(i => i.x >= page.width / 2)] : [body]), notes];
    for (let g = 0; g < groups.length; g++) {
      const sorted = groups[g].sort((a, b) => b.y - a.y || a.x - b.x);
      let current = null;
      for (const item of sorted) {
        const kind = g === 0 ? 'heading' : g === groups.length - 1 ? 'note' : 'para';
        if (!current || Math.abs(current.lastY - item.y) > item.size * 1.85 || (kind === 'heading' && Math.abs(current.lastY - item.y) > 2)) {
          current = {n: blocks.length + 1, kind, ...(kind === 'heading' ? {level: 1} : {}), text: '', page: page.index, pageLabel: labels?.[page.index] ?? String(page.index + 1),
            anchor: {type: 'pdf', page: page.index, items: []}, lastY: item.y}; blocks.push(current);
        }
        current.text += (current.text ? (Math.abs(current.lastY - item.y) > 2 ? '\n' : ' ') : '') + item.str;
        current.anchor.items.push(item.index); current.lastY = item.y;
      }
    }
  }
  for (const b of blocks) { b.text = normalizeText(b.text); delete b.lastY; }
  const outline = await pdf.getOutline(), chapters = [];
  async function visit(nodes, level = 1, parent = null) {
    for (const node of nodes ?? []) {
      const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
      let firstPage = null;
      if (dest) firstPage = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      const chapter = {id: `o${chapters.length + 1}`, title: node.title, level, parent, firstPage}; chapters.push(chapter);
      await visit(node.items, level + 1, chapter.id);
    }
  }
  await visit(outline);
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i], next = chapters.slice(i + 1).find(n => n.level <= c.level && n.firstPage !== null);
    c.lastPage = next ? next.firstPage - 1 : pdf.numPages - 1;
    const covered = blocks.filter(b => b.page >= c.firstPage && b.page <= c.lastPage);
    c.first = covered[0]?.n ?? null; c.last = covered.at(-1)?.n ?? null;
  }
  const detected = makeSections(blocks);
  return {extractorVersion: EXTRACTOR_VERSION, version: await versionOf(identity, blocks.map(b => b.text).join('\n')), blocks, sections: chapters.length ? chapters : detected, pageLabels: labels, removed,
    limitations: ['Prototype heuristics: unusual typography, mixed-direction PDFs and overlapping columns require additional fixtures before reader support is claimed.']};
}
export async function resolvePDFAnchor(pdf, anchor, scale = 1) {
  if (anchor.type !== 'pdf' || anchor.page < 0 || anchor.page >= pdf.numPages) return null;
  const page = await pdf.getPage(anchor.page + 1), content = await page.getTextContent(), viewport = page.getViewport({scale});
  const items = anchor.items.map(i => content.items[i]);
  if (items.some(i => !i?.str)) return null;
  return {page: anchor.page, text: normalizeText(items.map(i => i.str).join('\n')), rects: items.map(i => {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([i.transform[4], i.transform[5], i.transform[4] + i.width, i.transform[5] + i.height]);
    return {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
  })};
}
