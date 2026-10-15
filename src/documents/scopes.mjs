import {chapterSections} from './model.mjs';
import {generationFrame} from '../paths/seatline.mjs';
import {measureRequest, MAX_REQUEST_BYTES} from '../paths/limits.mjs';
export function buildScope(doc, choice = {kind:'document'}) {
  let selected, context = new Set(), spans = new Map(), label;
  switch (choice.kind) {
    case 'document': selected = doc.blocks; label = 'Whole document'; break;
    case 'section':
    case 'chapter': {
      const section = (choice.kind === 'chapter' ? chapterSections(doc, choice.level ?? doc.chapterLevel) : doc.sections).find(s => s.id === choice.id);
      if (!section) throw Error('SCOPE_NOT_FOUND');
      selected = doc.blocks.filter(b => b.n >= section.first && b.n <= section.last); label = section.title; break;
    }
    case 'pages': {
      if (doc.kind !== 'pdf' || !Number.isInteger(choice.first) || !Number.isInteger(choice.last) || choice.first < 0 || choice.last < choice.first || choice.last >= doc.pageCount) throw Error('INVALID_PAGE_RANGE');
      selected = doc.blocks.filter(b => b.page >= choice.first && b.page <= choice.last);
      label = `Pages ${doc.pageLabels[choice.first]}–${doc.pageLabels[choice.last]} (PDF ${choice.first+1}–${choice.last+1})`; break;
    }
    case 'selection': {
      if (!Array.isArray(choice.spans) || !choice.spans.length) throw Error('NO_SELECTION');
      for (const span of choice.spans) {
        const block = doc.blocks[span.n - 1];
        if (!block || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > block.text.length) throw Error('INVALID_SELECTION');
        if (!spans.has(span.n)) spans.set(span.n, []);
        spans.get(span.n).push({start:span.start,end:span.end});
      }
      const numbers = [...spans.keys()].sort((a,b) => a-b), first = numbers[0], last = numbers.at(-1);
      for (const n of [first-2,first-1,last+1]) if (n >= 1 && n <= doc.blocks.length && !spans.has(n)) context.add(n);
      const section = doc.sections.find(s => s.id === doc.blocks[first-1].section);
      if (section && doc.blocks[section.first-1]?.kind === 'heading' && !spans.has(section.first)) context.add(section.first);
      selected = doc.blocks.filter(b => spans.has(b.n) || context.has(b.n));
      label = `Selection · ¶${first}${first === last ? '' : `–${last}`}`; break;
    }
    default: throw Error('INVALID_SCOPE');
  }
  if (!selected.length) throw Error('EMPTY_SCOPE');
  return {docId:doc.id, version:doc.version, kind:choice.kind, label,
    blocks:selected.map(b => ({...b, context:context.has(b.n), ...(spans.has(b.n) ? {selected:spans.get(b.n)} : {})}))};
}
export function serializeScope(doc, scope) {
  if (scope.docId !== doc.id || scope.version !== doc.version) throw Error('STALE_SCOPE');
  // JSON escapes delimiters in source text. Prompt rules and lens instructions belong to D-01.
  return JSON.stringify({title:doc.title, lang:doc.language, scope:scope.label,...(doc.derived?{items:doc.derived.sources.map(s=>({id:s.itemId,title:s.title})),referencePolicy:'Cite projected block n values. originalRefs are original paragraph provenance, not output reference numbers.'}:{}),blocks:scope.blocks.map(({n,kind,level,text,page,pageLabel,context,selected,source}) =>
    ({n,kind,...(source?{item:source.itemId,originalRefs:source.refs??[source.n]}:{}),...(level ? {level} : {}),text,...(page !== undefined ? {page,pageLabel} : {}),...(context ? {context:true} : {}),...(selected ? {selected:selected.map(({start,end})=>({start,end,text:text.slice(start,end)}))} : {})}))});
}
export function scopeRequest(doc, scope, request = {}) {
  return {kind:'analysis', rules:'', task:'Read the selected scope.', priority:'interactive', session:{mode:'none'}, cleanupGroup:`doc-${doc.id.slice(0,32)}`, ...request, document:serializeScope(doc,scope)};
}
export function scopeSize(doc, scope, {target = {path:'seatline',provider:'claude',model:null}, request = {}, policy = {allowGeminiCloud:true}} = {}) {
  const prompt = scopeRequest(doc,scope,request), frame = generationFrame(target,prompt,policy), requestBytes = measureRequest(frame);
  const text = [prompt.rules,prompt.document,prompt.task].join('\n');
  // A conservative language-neutral character heuristic; no tokenizer/model-specific precision is claimed.
  const codepoints = [...text].length, wide = (text.match(/[\u2e80-\u9fff\uac00-\ud7af]/gu) || []).length;
  return {estimatedTokens:Math.ceil((codepoints-wide)/3+wide), requestBytes, maxRequestBytes:MAX_REQUEST_BYTES,
    fits:requestBytes <= MAX_REQUEST_BYTES, hint:requestBytes > MAX_REQUEST_BYTES ? 'Choose a selection, section, chapter or smaller page range.' : null};
}
