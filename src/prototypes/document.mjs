import {sha256} from '@noble/hashes/sha2.js';
export const EXTRACTOR_VERSION = 'foundation-2';
// HTML source wrapping is whitespace, not proof of discretionary hyphenation.
export const normalizeText = text => text.normalize('NFC').replace(/\u00ad/g, '').replace(/\s+/gu, ' ').trim();
export function normalizePDFText(text) {
  return normalizeText(text.replace(/(\p{L}{6,})-[ \t]*\n[ \t]*(\p{Ll}{3,})(?![\p{L}-])/gu, '$1$2').replace(/\u00ad[ \t]*\n[ \t]*/gu, ''));
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
export async function versionOf(identity, text) {
  // Works in HTTP content scripts too; no dependency on secure-context WebCrypto.
  return Array.from(sha256(new TextEncoder().encode(`${EXTRACTOR_VERSION}\n${identity}\n${text}`)), b => b.toString(16).padStart(2, '0')).join('');
}
