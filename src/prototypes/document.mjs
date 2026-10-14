export const EXTRACTOR_VERSION = 'foundation-1';
export const normalizeText = text => text.normalize('NFC').replace(/\u00ad/g, '').replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2').replace(/\s+/gu, ' ').trim();
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
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${EXTRACTOR_VERSION}\n${identity}\n${text}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
