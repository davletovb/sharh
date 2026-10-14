import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {EXTRACTOR_VERSION, normalizePDFText, versionOf} from './document.mjs';
import {pdfItem, extractPDFBlocks, outlineSections} from './pdf-layout.mjs';
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
export async function openPDF(data) {
  return getDocument({data: new Uint8Array(data), isEvalSupported: false, standardFontDataUrl: '/standard_fonts/', useSystemFonts: true}).promise;
}
export async function extractPDF(pdf, identity = 'local-pdf') {
  const pages = [], labels = await pdf.getPageLabels();
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1), content = await page.getTextContent();
    // Layout uses unrotated, crop-relative viewport coordinates; highlighting uses display rotation.
    const viewport = page.getViewport({scale: 1, rotation: 0});
    pages.push({index, viewport, height: viewport.height, width: viewport.width, label: labels?.[index] ?? String(index + 1), items: content.items.map((item, i) => pdfItem(item, i, viewport)).filter(item => item.str?.trim())});
  }
  const {blocks, removed} = extractPDFBlocks(pages), {sections, warnings} = await outlineSections(pdf, blocks, pages);
  for (const block of blocks) { delete block.top; delete block.bottom; }
  return {extractorVersion: EXTRACTOR_VERSION, version: await versionOf(identity, JSON.stringify(blocks)), blocks, sections, pageLabels: labels ?? pages.map(p => p.label), removed, warnings,
    limitations: ['Prototype heuristics: ambiguous hard-hyphen compounds, unusual typography, mixed-direction PDFs and overlapping columns require additional fixtures before reader support is claimed.']};
}
export async function resolvePDFAnchor(pdf, anchor, scale = 1) {
  if (anchor.type !== 'pdf' || anchor.page < 0 || anchor.page >= pdf.numPages) return null;
  const page = await pdf.getPage(anchor.page + 1), content = await page.getTextContent(), viewport = page.getViewport({scale});
  const items = anchor.items.map(i => content.items[i]);
  if (items.some(i => !i?.str)) return null;
  return {page: anchor.page, text: normalizePDFText(items.map((i, index) => (anchor.separators?.[index] ?? (index ? '\n' : '')) + i.str).join('')), rects: items.map(i => {
    const [x1, y1] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
    const [x2, y2] = viewport.convertToViewportPoint(i.transform[4] + i.width, i.transform[5] + i.height);
    return {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
  })};
}
