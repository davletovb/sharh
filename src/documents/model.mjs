import {sha256} from '@noble/hashes/sha2.js';
export const EXTRACTOR_VERSION = 'reader-1';
export const contentHash = data => Array.from(sha256(data), b => b.toString(16).padStart(2, '0')).join('');
const hash = text => contentHash(new TextEncoder().encode(text));
export const normalizeText = text => text.normalize('NFC').replace(/\u00ad/g, '').replace(/\s+/gu, ' ').trim();
export function normalizePDFText(text) {
  return normalizeText(text.replace(/(\p{L}{6,})-[ \t]*\n[ \t]*(\p{Ll}{3,})(?![\p{L}-])/gu, '$1$2').replace(/\u00ad[ \t]*\n[ \t]*/gu, ''));
}
export async function versionOf(identity, content) {
  return hash(`${EXTRACTOR_VERSION}\n${identity}\n${content}`);
}
export function makeSections(blocks) {
  const sections = [], stack = [];
  for (const block of blocks) {
    if (block.kind === 'heading') {
      while (stack.length && stack.at(-1).level >= block.level) stack.pop();
      const section = {id: `s${sections.length + 1}`, title: block.text, level: block.level, parent: stack.at(-1)?.id ?? null, first: block.n, last: block.n};
      sections.push(section); stack.push(section);
    }
    block.section = stack.at(-1)?.id ?? null;
    for (const section of stack) {
      section.last = block.n;
      if (block.page !== undefined) { section.firstPage ??= block.page; section.lastPage = block.page; }
    }
  }
  return sections;
}
export function chapterSections(doc, level = doc.chapterLevel) {
  return doc.sections.filter(s => s.level === level && Number.isInteger(s.first));
}
export function createDocument(extraction, {kind, identity, address = null, fileName = null, title, language, chapterLevel} = {}) {
  if (!['html', 'pdf'].includes(kind) || typeof identity !== 'string' || !identity) throw Error('INVALID_DOCUMENT_IDENTITY');
  const levels = extraction.sections.filter(s => Number.isInteger(s.first)).map(s => s.level);
  const doc = {...extraction, id: hash(`${kind}\n${identity}`), identity, kind, address, fileName,
    title: title || extraction.title || fileName || 'Untitled document', language: language || extraction.language || null,
    chapterLevel: chapterLevel ?? (levels.length ? Math.min(...levels) : 1)};
  validateDocument(doc);
  return doc;
}
export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || !/^[a-f0-9]{64}$/.test(doc.id) || !/^[a-f0-9]{64}$/.test(doc.version) ||
      !['html', 'pdf'].includes(doc.kind) || typeof doc.identity !== 'string' || typeof doc.title !== 'string' ||
      typeof doc.extractorVersion !== 'string' || !Array.isArray(doc.blocks) || !Array.isArray(doc.sections) ||
      !doc.blocks.length || !Number.isSafeInteger(doc.chapterLevel) || doc.chapterLevel < 1) throw Error('INVALID_DOCUMENT');
  const sections = new Map(doc.sections.map(s => [s.id, s]));
  if (sections.size !== doc.sections.length) throw Error('DUPLICATE_SECTION');
  for (const [index, block] of doc.blocks.entries()) {
    if (block.n !== index + 1 || !['para','heading','quote','list','caption','note','table'].includes(block.kind) ||
        typeof block.text !== 'string' || !block.text || !block.text.isWellFormed() || block.text.includes('\0') ||
        (block.kind === 'heading' && (!Number.isInteger(block.level) || block.level < 1)) ||
        (block.section != null && !sections.has(block.section))) throw Error('INVALID_BLOCK');
    const a = block.anchor;
    if (doc.kind === 'html') {
      if (a?.type !== 'html' || typeof a.path !== 'string' || a.quote?.exact !== block.text ||
          !Number.isSafeInteger(a.position?.start) || !Number.isSafeInteger(a.position?.end) ||
          a.position.start < 0 || a.position.end <= a.position.start) throw Error('INVALID_HTML_ANCHOR');
    } else if (a?.type !== 'pdf' || !Number.isSafeInteger(block.page) || block.page < 0 || a.page !== block.page ||
        typeof block.pageLabel !== 'string' || !Array.isArray(a.items) || !a.items.length ||
        a.items.some(i => !Number.isSafeInteger(i) || i < 0) || !Array.isArray(a.separators) || a.separators.length !== a.items.length) throw Error('INVALID_PDF_ANCHOR');
  }
  for (const section of doc.sections) {
    if (typeof section.id !== 'string' || typeof section.title !== 'string' || !Number.isInteger(section.level) || section.level < 1 ||
        !Number.isInteger(section.first) || !Number.isInteger(section.last) || section.first < 1 || section.last < section.first || section.last > doc.blocks.length ||
        (section.parent != null && !sections.has(section.parent))) throw Error('INVALID_SECTION');
    const visited = new Set([section.id]); let parent = section.parent;
    while (parent != null) { if (visited.has(parent)) throw Error('SECTION_CYCLE'); visited.add(parent); parent = sections.get(parent).parent; }
  }
  return doc;
}
