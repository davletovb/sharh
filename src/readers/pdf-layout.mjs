import {normalizeText, normalizePDFText, makeSections} from '../documents/model.mjs';
export function pdfItem(item, index, viewport) {
  const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
  return {...item, index, x, y, size: Math.hypot(item.transform[2], item.transform[3]) || item.height};
}
function linesOf(items, headingThreshold) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - item.y) <= Math.max(2, item.size * .2)) row.items.push(item);
    else rows.push({y: item.y, items: [item]});
  }
  const lines = [];
  for (const row of rows) {
    let line;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const heading = item.size >= headingThreshold;
      if (!line || item.x - line.right > item.size * 2 || heading !== line.heading) {
        line = {x: item.x, y: item.y, right: item.x, size: item.size, heading, items: []}; lines.push(line);
      }
      line.items.push(item); line.right = Math.max(line.right, item.x + item.width); line.size = Math.max(line.size, item.size);
    }
  }
  return lines;
}
export function extractPDFBlocks(pages) {
  const repeated = new Map(), removed = [], blocks = [];
  for (const page of pages) for (const text of new Set(page.items.filter(i => i.y < 35 || i.y > page.height - 35).map(i => normalizeText(i.str)))) repeated.set(text, (repeated.get(text) ?? 0) + 1);
  const weights = new Map();
  for (const page of pages) for (const item of page.items.filter(i => i.y > page.height * .15 && i.y < page.height * .75)) weights.set(Math.round(item.size), (weights.get(Math.round(item.size)) ?? 0) + item.str.length);
  const bodySize = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
  const threshold = Math.max(14, bodySize * 1.2), headingSizes = [...new Set(pages.flatMap(p => p.items.filter(i => i.size >= threshold).map(i => Math.round(i.size))))].sort((a, b) => b - a);
  for (const page of pages) {
    const items = page.items.filter(item => {
      const margin = item.y < 35 || item.y > page.height - 35;
      if (margin && ((repeated.get(normalizeText(item.str)) ?? 0) > 1 || /^\d+$/.test(item.str))) { removed.push({page: page.index, text: item.str, cause: 'running-margin'}); return false; }
      return true;
    });
    const lines = linesOf(items, threshold);
    for (const line of lines) { line.kind = line.heading ? 'heading' : line.size < bodySize * .85 && line.y > page.height * .75 ? 'note' : 'para'; if (line.heading) line.level = headingSizes.indexOf(Math.round(line.size)) + 1; }
    const body = lines.filter(l => l.kind !== 'note'), notes = lines.filter(l => l.kind === 'note');
    const split = page.width / 2, twoColumns = body.some(l => !l.heading && l.x > split) && body.some(l => !l.heading && l.x < page.width / 3);
    const ordered = []; let band = [];
    const flush = () => { ordered.push(...(twoColumns ? [band.filter(l => l.x < split), band.filter(l => l.x >= split)].flat() : band)); band = []; };
    for (const line of body) {
      // A full-width/main heading divides column bands at its actual vertical position.
      if (twoColumns && line.heading && (line.level === 1 || line.x < split && line.right > split)) { flush(); ordered.push(line); }
      else band.push(line);
    }
    flush(); ordered.push(...notes);
    let current, lastLine;
    for (const line of ordered) {
      const column = twoColumns ? Number(line.x >= split) : 0;
      if (!current || current.kind !== line.kind || line.heading || column !== lastLine.column || line.y < lastLine.y || line.y - lastLine.y > line.size * 1.85) {
        current = {n: blocks.length + 1, kind: line.kind, ...(line.heading ? {level: line.level} : {}), text: '', page: page.index, pageLabel: page.label,
          top: line.y - line.size, bottom: line.y, anchor: {type: 'pdf', page: page.index, items: [], separators: []}}; blocks.push(current);
      }
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i], previous = line.items[i - 1];
        const separator = !current.anchor.items.length ? '' : i === 0 ? '\n' : item.x - (previous.x + previous.width) > item.size * .12 ? ' ' : '';
        current.text += separator + item.str; current.anchor.items.push(item.index); current.anchor.separators.push(separator);
      }
      current.bottom = line.y; lastLine = {...line, column};
    }
  }
  for (const block of blocks) block.text = normalizePDFText(block.text);
  return {blocks, removed};
}
export async function outlineSections(pdf, blocks, pages) {
  const chapters = [], warnings = []; let outline;
  try { outline = await pdf.getOutline(); } catch { warnings.push({cause: 'outline-unavailable'}); }
  async function visit(nodes, level = 1, parent = null) {
    for (const node of nodes ?? []) {
      const chapter = {id: `o${chapters.length + 1}`, title: node.title, level, parent, firstPage: null, lastPage: null, first: null, last: null};
      chapters.push(chapter);
      try {
        const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
        if (!Array.isArray(dest) || !dest.length) throw new Error('no destination');
        const page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
        if (!Number.isInteger(page) || page < 0 || page >= pages.length) throw new Error('invalid page');
        chapter.firstPage = page;
        const top = dest[1]?.name === 'XYZ' ? dest[3] : ['FitH', 'FitBH'].includes(dest[1]?.name) ? dest[2] : null;
        const y = Number.isFinite(top) ? pages[page].viewport.convertToViewportPoint(0, top)[1] : null;
        const onPage = blocks.filter(b => b.page === page), title = normalizeText(node.title).toLocaleLowerCase();
        const heading = onPage.find(b => b.kind === 'heading' && (b.text.toLocaleLowerCase() === title || b.text.toLocaleLowerCase().startsWith(title + ':')));
        const atDestination = y === null ? null : onPage.find(b => b.bottom >= y - 2);
        chapter.first = (heading ?? atDestination ?? onPage[0])?.n ?? null;
      } catch { warnings.push({id: chapter.id, cause: 'unresolved-outline-destination'}); }
      await visit(node.items, level + 1, chapter.id);
    }
  }
  await visit(outline);
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]; if (c.first === null) continue;
    const next = chapters.slice(i + 1).find(n => n.level <= c.level && n.first !== null && n.first >= c.first);
    if (next?.first === c.first) {
      c.last = blocks.filter(b => b.page === c.firstPage).at(-1)?.n ?? c.first;
      warnings.push({id: c.id, cause: 'outline-shared-start', detail: 'Page-only destinations share a start; overlapping page spans retained.'});
    } else c.last = next ? next.first - 1 : blocks.at(-1).n;
    c.lastPage = blocks.find(b => b.n === c.last)?.page ?? c.firstPage;
  }
  if (!chapters.some(c => c.first !== null)) return {sections: makeSections(blocks), warnings};
  for (const block of blocks) {
    const candidates = chapters.filter(c => c.first !== null && block.n >= c.first && block.n <= c.last);
    candidates.sort((a, b) => b.level - a.level || b.first - a.first || Number(b.id.slice(1)) - Number(a.id.slice(1)));
    block.section = candidates[0]?.id ?? null;
  }
  return {sections: chapters, warnings};
}
