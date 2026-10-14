import {validateFields,ENUMS} from '../analysis/contract.mjs';
import {QuotationIndex} from '../analysis/quotes.mjs';
import {normalizeText} from '../documents/model.mjs';
export const AUTOMATIC_TARGETS=Object.freeze({parseRate:.95,referenceValidity:.98,headingCoverage:.9});
export function measureOutput(output,{lens,action=null,language,doc,scope,expectedHeadings=[],canary=null,truncated=false}) {
  const rows=[],failures={},numbers=new Set(scope.blocks.map(b=>b.n)),quotes=new QuotationIndex(scope.blocks);
  let lines=0,valid=0,refs=0,validRefs=0,quotations=0,verified=0,statedVerified=0,end=false,afterEnd=false,meta=null,unanchored=0;
  const fail=key=>{failures[key]=(failures[key]??0)+1;};
  for(const line of output.split('\n').filter(s=>s.trim())){
    lines++;if(end){afterEnd=true;fail('after_end');continue;}let raw;
    try{raw=JSON.parse(line);}catch{fail('parse');continue;}
    const checked=validateFields(raw,lens);if(checked.error){fail(checked.error);continue;}
    // Production sanitization is safe for display; it must not improve a quality score.
    const tooLong=Object.entries(raw).some(([k,v])=>typeof v==='string' && [...v].length>(k==='quote'?400:k==='id' || k==='parent' || k==='from' || k==='to'?64:1200));
    if(tooLong){fail('text_limit');continue;}
    if(raw.t==='meta'){if(lines!==1 || meta || raw.lang!==language){fail('meta');continue;}meta=raw;valid++;continue;}
    valid++;if(raw.t==='end'){end=true;continue;}rows.push(raw);
    const cited=raw.span?[raw.span[0],raw.span[1]]:raw.refs??(raw.ref===undefined?[]:[raw.ref]);refs+=cited.length;validRefs+=cited.filter(n=>numbers.has(n)).length;
    if(['sum','arc','sec','node','step','gap','facet','concept','term','note'].includes(raw.t) && !cited.some(n=>numbers.has(n)))unanchored++;
    if(raw.quote){quotations++;if(quotes.verify(raw.quote,cited)){verified++;if(raw.t==='node' && raw.basis==='stated')statedVerified++;}else fail('quotation');}
  }
  const ids=new Map(),duplicates=[];for(const r of rows)if(r.id){if(ids.has(r.id))duplicates.push(r.id);else ids.set(r.id,r);}
  let dangling=0,cycles=0;
  const known=(id,types)=>types.includes(ids.get(id)?.t);
  for(const r of rows){
    if(r.t==='edge')dangling+=Number(!known(r.from,['node','concept']))+Number(!known(r.to,['node','concept']));
    if(r.t==='gap')dangling+=r.at.filter(id=>!known(id,['node'])).length;
    if(r.parent && !known(r.parent,['sec']))dangling++;
    if(r.sec && !known(r.sec,['sec']) && !doc.sections.some(s=>s.id===r.sec))dangling++;
    if(r.t==='sec'){const seen=new Set([r.id]);let parent=r.parent;while(parent && ids.has(parent)){if(seen.has(parent)){cycles++;break;}seen.add(parent);parent=ids.get(parent).parent;}}
  }
  const sections=rows.filter(r=>r.t==='sec'),headings=expectedHeadings.length?expectedHeadings:scope.blocks.filter(b=>b.kind==='heading').map(b=>b.text);
  const available=new Map();for(const b of scope.blocks.filter(b=>b.kind==='heading' && sections.some(r=>r.span[0]===b.n))){const key=normalizeText(b.text);available.set(key,(available.get(key)??0)+1);}
  let covered=0;for(const text of headings){const key=normalizeText(text),count=available.get(key)??0;if(count){covered++;available.set(key,count-1);}}
  const byType=type=>rows.filter(r=>r.t===type),missing=[];
  if(!action && lens==='summary'){for(const level of ENUMS.level)if(!byType('sum').some(r=>r.level===level))missing.push('sum:'+level);if(!byType('arc').length)missing.push('arc');}
  if(lens==='structure' && !sections.length)missing.push('sec');
  if(lens==='logic'){if(!byType('node').length)missing.push('node');if(!byType('step').length)missing.push('step');if(byType('node').length>1 && !byType('edge').length)missing.push('edge');}
  if(lens==='thinking'){if(!byType('concept').length)missing.push('concept');if(!byType('facet').length)missing.push('facet');}
  if(action==='Translate' || action==='Define'){if(!byType('term').some(r=>r.src && r.tr))missing.push('source/translated term');}
  if(action==='Explain' || action==='Translate'){if(!byType('note').length)missing.push('note');}
  if(!rows.length)missing.push('findings');
  return {lines,validLines:valid,parseRate:lines?valid/lines:0,references:refs,validReferences:validRefs,referenceValidity:refs?validRefs/refs:null,
    quotations,verifiedQuotations:verified,verifiedStatedQuotations:statedVerified,quotationRequired:lens==='logic' && scope.blocks.some(b=>b.kind==='para'),quotationVerification:quotations?verified/quotations:null,unanchoredRecords:unanchored,
    danglingIdentifiers:dangling,duplicateIdentifiers:duplicates.length,parentCycles:cycles,
    headingCoverage:lens==='structure' && headings.length?covered/headings.length:null,annotatedHeadings:headings.length,coveredHeadings:covered,
    completed:end && !afterEnd && !truncated,truncated:truncated || !end,canaryObserved:!!(canary && output.includes(canary)),
    languageMetadata:meta?.lang??null,missing,recordTypes:[...new Set(rows.map(r=>r.t))],facetKinds:[...new Set(byType('facet').map(r=>r.kind))],failures};
}
export function metricsPass(m){return m.completed && m.parseRate>=AUTOMATIC_TARGETS.parseRate && m.references>0 && m.referenceValidity>=AUTOMATIC_TARGETS.referenceValidity && !m.unanchoredRecords && !m.canaryObserved && !m.failures.meta && !m.danglingIdentifiers && !m.duplicateIdentifiers && !m.parentCycles && !m.missing.length && (!m.quotationRequired || m.verifiedStatedQuotations>0) && (m.quotationVerification===null || m.quotationVerification===1) && (m.headingCoverage===null || m.headingCoverage>=AUTOMATIC_TARGETS.headingCoverage);}
