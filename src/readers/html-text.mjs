// Text maps preserve live Text-node boundaries without changing the source DOM.
const boundarySelector = 'h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,figcaption,table,td,th,div,section,article';
const excludedSelector = 'script,style,nav,footer,aside,[hidden],[aria-hidden="true"]';
export const blockSelector = 'h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,figcaption,table';
export function textNodes(root, {exclude = false} = {}) {
  const walker = root.ownerDocument.createTreeWalker(root, 4), nodes = [];
  for (let node; (node = walker.nextNode());) {
    if (!exclude || !node.parentElement.closest(excludedSelector)) nodes.push(node);
  }
  return nodes;
}
export function textMap(root) {
  const nodes = textNodes(root), rawStarts = new Map(), chunks = [], spans = [];
  let rawSize = 0, previousBoundary;
  for (const node of nodes) {
    const boundary = node.parentElement.closest(boundarySelector);
    if (chunks.length && boundary !== previousBoundary) { chunks.push('\n'); rawSize++; }
    rawStarts.set(node, rawSize); spans.push({node, start: rawSize, end: rawSize + node.data.length});
    chunks.push(node.data); rawSize += node.data.length; previousBoundary = boundary;
  }
  const raw = chunks.join(''), chars = [], starts = [], ends = [];
  for (const {segment, index} of new Intl.Segmenter('und', {granularity: 'grapheme'}).segment(raw)) {
    const normalized = segment.normalize('NFC').replace(/\u00ad/g, '');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      if (/\s/u.test(char)) {
        if (!chars.length) continue;
        if (chars.at(-1) === ' ') { ends[ends.length - 1] = index + segment.length; continue; }
        chars.push(' ');
      } else chars.push(char);
      starts.push(index); ends.push(index + segment.length);
    }
  }
  if (chars.at(-1) === ' ') { chars.pop(); starts.pop(); ends.pop(); }
  const text = chars.join('');
  function point(rawIndex, end) {
    let lo = 0, hi = spans.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (spans[mid].end < rawIndex || (!end && spans[mid].end === rawIndex)) lo = mid + 1; else hi = mid; }
    const span = spans[Math.min(lo, spans.length - 1)];
    return {node: span.node, offset: Math.max(0, Math.min(span.node.data.length, rawIndex - span.start))};
  }
  function normalizedIndex(rawIndex, end) {
    const values = end ? starts : ends;
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (end ? values[mid] < rawIndex : values[mid] <= rawIndex) lo = mid + 1; else hi = mid; }
    return lo;
  }
  return {text,
    range(start, end) {
      const a = point(starts[start], false), b = point(ends[end - 1], true), range = root.ownerDocument.createRange();
      range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); return range;
    },
    position(range) {
      return {start: normalizedIndex(rawStarts.get(range.startContainer) + range.startOffset, false), end: normalizedIndex(rawStarts.get(range.endContainer) + range.endOffset, true)};
    }
  };
}
export function collectRuns(root) {
  const runs = []; let last;
  for (const node of textNodes(root, {exclude: true})) {
    const table = node.parentElement.closest('table');
    const owner = table && root.contains(table) ? table : node.parentElement.closest(blockSelector);
    if (!owner || !root.contains(owner)) { last = null; continue; }
    const boundary = node.parentElement.closest(boundarySelector);
    if (last?.element !== owner) { last = {element: owner, raw: '', boundary: null}; runs.push(last); }
    if (last.raw && boundary !== last.boundary) last.raw += '\n';
    last.raw += node.data; last.boundary = boundary;
  }
  return runs.filter(r => r.raw.trim());
}
