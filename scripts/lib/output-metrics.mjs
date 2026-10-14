// Deliberately strict draft-contract measurement, not the D-02 production validator.
import {normalizeText} from '../../src/prototypes/document.mjs';
const roles = ['context','question','definition','claim','evidence','example','objection','rebuttal','concession','method','synthesis','transition','conclusion'];
const nodeKinds = ['premise','evidence','inference','claim','conclusion','objection','rebuttal','assumption','definition'];
const relations = ['supports','attacks','qualifies','elaborates','exemplifies','presupposes'];
const gapKinds = ['unstated_premise','leap','circularity','equivocation','overgeneralization','false_dichotomy','missing_evidence','other'];
const nonempty = (v, cap = 1200) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= cap;
const integers = v => Array.isArray(v) && v.length > 0 && v.every(Number.isInteger);
const normalizeQuote = s => normalizeText(s).replace(/[‘’ʻʼ`]/gu, "'").replace(/[“”«»]/gu, '"').replace(/[‐‑‒–—−]/gu, '-');
export function verifyQuote(quote, refs, blocks) {
  const parts = normalizeQuote(quote).split('…').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  // Only join adjacent paragraphs; disjoint references cannot manufacture a quotation.
  const cited = new Set(refs);
  const allowed = blocks.filter(b => refs.some(n => Math.abs(b.n - n) <= 1));
  const groups = [];
  for (const b of allowed) {
    if (!groups.length || groups.at(-1).at(-1).n !== b.n - 1) groups.push([]);
    groups.at(-1).push(b);
  }
  return groups.some(group => {
    const intervals = []; let length = 0;
    for (const block of group) { const text = normalizeQuote(block.text); intervals.push({n: block.n, start: length, end: length + text.length}); length += text.length + 1; }
    const text = normalizeQuote(group.map(b => b.text).join(' '));
    // Earliest possible end for each citation state. Later duplicate matches can still anchor a quote.
    let uncitedEnd = 0, citedEnd = Infinity;
    for (const part of parts) {
      let nextUncited = Infinity, nextCited = Infinity;
      for (let index = text.indexOf(part); index >= 0; index = text.indexOf(part, index + 1)) {
        const end = index + part.length;
        const anchored = intervals.some(b => cited.has(b.n) && index < b.end && end > b.start);
        if (index >= citedEnd || index >= uncitedEnd && anchored) nextCited = Math.min(nextCited, end);
        if (index >= uncitedEnd && !anchored) nextUncited = Math.min(nextUncited, end);
      }
      uncitedEnd = nextUncited; citedEnd = nextCited;
    }
    return citedEnd !== Infinity;
  });
}
function schema(r, lens) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (r.t === 'end') return Object.keys(r).length === 1;
  if (r.t === 'meta') return r.lens === lens && nonempty(r.lang);
  if (r.t === 'note') return nonempty(r.text) && (r.refs === undefined || integers(r.refs));
  if (lens === 'structure') return r.t === 'sec' && nonempty(r.id) && (r.parent === undefined || nonempty(r.parent)) && nonempty(r.title) && nonempty(r.gist) && roles.includes(r.role) && integers(r.span) && r.span.length === 2 && r.span[0] <= r.span[1];
  if (lens !== 'logic') return false;
  switch (r.t) {
    case 'node': return nonempty(r.id) && nodeKinds.includes(r.kind) && nonempty(r.text) && integers(r.refs) && ['stated','inferred'].includes(r.basis) && (r.quote === undefined || nonempty(r.quote, 400));
    case 'edge': return nonempty(r.from) && nonempty(r.to) && relations.includes(r.rel) && (r.text === undefined || nonempty(r.text));
    case 'step': return Number.isInteger(r.n) && r.n > 0 && nonempty(r.text) && integers(r.refs);
    case 'gap': return gapKinds.includes(r.kind) && Array.isArray(r.at) && r.at.length > 0 && r.at.every(id => nonempty(id, 128)) && nonempty(r.text) && integers(r.refs);
    default: return false;
  }
}
export class OutputMetrics {
  constructor({lens, blocks, canary = null, now = () => performance.now()}) {
    Object.assign(this, {lens, blocks, canary, now, start: now(), buffer: '', output: '', lines: 0, parsed: 0, valid: 0, references: 0, validReferences: 0, quotations: 0, verifiedQuotations: 0, endReceived: false, verifiedStatedQuotations: 0, afterEnd: false, records: [], failures: {}, firstMs: null});
  }
  push(text) {
    this.output += text; this.buffer += text;
    for (let i; (i = this.buffer.indexOf('\n')) >= 0;) { const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 1); this.line(line); }
  }
  line(line) {
    if (!line.trim()) return;
    this.lines++;
    if (this.endReceived) this.afterEnd = true;
    let r;
    try { r = JSON.parse(line); } catch { this.failures.parse = (this.failures.parse ?? 0) + 1; return; }
    this.parsed++;
    if (r?.t === 'meta' && this.lines !== 1) { this.failures.meta_order = (this.failures.meta_order ?? 0) + 1; return; }
    if (!schema(r, this.lens)) { this.failures.schema = (this.failures.schema ?? 0) + 1; return; }
    this.valid++;
    if (r.t === 'end') { this.endReceived = true; return; }
    this.records.push(r);
    if (r.t !== 'meta' && this.firstMs === null) this.firstMs = this.now() - this.start;
    const refs = r.span ? [r.span[0], r.span[1]] : r.refs ?? [];
    const scope = new Set(this.blocks.map(b => b.n));
    this.references += refs.length;
    this.validReferences += refs.filter(n => scope.has(n)).length;
    if (r.quote) {
      this.quotations++;
      if (verifyQuote(r.quote, refs, this.blocks)) { this.verifiedQuotations++; if (r.t === 'node' && r.basis === 'stated') this.verifiedStatedQuotations++; }
    }
  }
  finish() {
    if (this.buffer.trim()) { this.line(this.buffer); this.buffer = ''; }
    const ids = this.records.filter(r => r.id).map(r => r.id), known = new Set(ids);
    const dangling = this.records.flatMap(r => [r.parent, r.from, r.to, ...(r.at ?? [])].filter(Boolean)).filter(id => !known.has(id));
    const cycles = this.records.filter(r => r.t === 'sec').some(r => {
      const seen = new Set([r.id]); let parent = r.parent;
      while (parent) { if (seen.has(parent)) return true; seen.add(parent); parent = this.records.find(n => n.id === parent)?.parent; }
      return false;
    });
    const headings = this.blocks.filter(b => b.kind === 'heading');
    return {lines: this.lines, parsedLines: this.parsed, validRecords: this.valid, parseRate: this.lines ? this.valid / this.lines : 0,
      references: this.references, validReferences: this.validReferences, referenceValidity: this.references ? this.validReferences / this.references : null,
      quotationRequired: this.lens === 'logic' && this.blocks.some(b => b.kind === 'para' && b.text.trim()), verifiedStatedQuotations: this.verifiedStatedQuotations,
      quotations: this.quotations, verifiedQuotations: this.verifiedQuotations, quotationVerification: this.quotations ? this.verifiedQuotations / this.quotations : null,
      danglingIdentifiers: dangling.length, duplicateIdentifiers: ids.length - known.size, parentCycle: cycles,
      headingCoverage: this.lens === 'structure' && headings.length ? headings.filter(b => this.records.some(r => r.t === 'sec' && r.span[0] === b.n)).length / headings.length : null,
      completed: this.endReceived && !this.afterEnd, truncated: !this.endReceived, timeToFirstRecordMs: this.firstMs, totalMs: this.now() - this.start,
      canaryObserved: this.canary ? this.output.includes(this.canary) : false, failures: this.failures};
  }
}
