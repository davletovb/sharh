import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {EXTRACTOR_VERSION, normalizePDFText, versionOf} from '../documents/model.mjs';
import {pdfItem, extractPDFBlocks, outlineSections} from './pdf-layout.mjs';
export async function openPDF(data, {workerSrc = '/pdf.worker.mjs', standardFontDataUrl = '/standard_fonts/', wasmUrl} = {}) {
  GlobalWorkerOptions.workerSrc = workerSrc;
  // PDF.js transfers its input; preserve the caller's bytes for storage and reload.
  return getDocument({data: new Uint8Array(data).slice(), isEvalSupported: false, standardFontDataUrl, ...(wasmUrl ? {wasmUrl} : {}), useSystemFonts: true}).promise;
}
export async function extractPDF(pdf, identity = 'local-pdf', {sourceHash = null} = {}) {
  const pages = [], labels = await pdf.getPageLabels();
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1), content = await page.getTextContent();
    // Layout uses unrotated, crop-relative viewport coordinates; highlighting uses display rotation.
    const viewport = page.getViewport({scale: 1, rotation: 0});
    pages.push({index, viewport, height: viewport.height, width: viewport.width, label: labels?.[index] ?? String(index + 1), items: content.items.map((item, i) => pdfItem(item, i, viewport)).filter(item => item.str?.trim())});
  }
  const {blocks, removed} = extractPDFBlocks(pages), {sections, warnings} = await outlineSections(pdf, blocks, pages);
  for (const block of blocks) { delete block.top; delete block.bottom; block.anchor.quote = {exact:block.text}; }
  const validSections = sections.filter(s => Number.isInteger(s.first) && Number.isInteger(s.last));
  const ids = new Set(validSections.map(s => s.id));
  for (const s of validSections) if (!ids.has(s.parent)) s.parent = null;
  const metadata = await pdf.getMetadata().catch(() => null), title = metadata?.info?.Title || null;
  const pageLabels = labels ?? pages.map(p => p.label);
  return {title, language: metadata?.info?.Language || null, extractorVersion: EXTRACTOR_VERSION,
    version: await versionOf(identity, JSON.stringify({sourceHash, fingerprints:pdf.fingerprints, blocks, sections:validSections, pageLabels})),
    blocks, sections:validSections, pageCount:pdf.numPages, pageLabels, removed, warnings,
    limitations: ['No OCR. Complex overlapping layouts and mixed-direction PDF reading order need additional evaluation.']};
}
export async function resolvePDFAnchor(pdf, anchor, scale = 1) {
  if (anchor.type !== 'pdf' || anchor.page < 0 || anchor.page >= pdf.numPages) return null;
  const page = await pdf.getPage(anchor.page + 1), content = await page.getTextContent(), viewport = page.getViewport({scale});
  const items = anchor.items.map(i => content.items[i]);
  if (items.some(i => !i?.str)) return null;
  const text = normalizePDFText(items.map((i, index) => (anchor.separators?.[index] ?? (index ? '\n' : '')) + i.str).join(''));
  if (anchor.quote?.exact && text !== anchor.quote.exact) return null;
  return {page: anchor.page, text, rects: items.map(i => textItemRect(i, viewport))};
}
export function textItemRect(item, viewport) {
  const [a,b,c,d,x,y] = item.transform, xSize = Math.hypot(a,b) || 1, ySize = Math.hypot(c,d) || 1;
  const width = item.width, height = item.height || ySize;
  const corners = [[0,0],[width,0],[0,height],[width,height]].map(([dx,dy]) => viewport.convertToViewportPoint(x + dx*a/xSize + dy*c/ySize, y + dx*b/xSize + dy*d/ySize));
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  return {x:Math.min(...xs), y:Math.min(...ys), width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys)};
}
