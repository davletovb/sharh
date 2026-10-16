import {cleanText} from '../documents/model.mjs';

export const PROMPT_VERSION = 'analysis-5';
export const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const ENUMS = Object.freeze({
  level: ['line','abstract','section','brief'],
  stage: ['opening','problem','development','turn','resolution'],
  role: ['context','question','definition','claim','evidence','example','objection','rebuttal','concession','method','synthesis','transition','conclusion'],
  node: ['premise','evidence','inference','claim','conclusion','objection','rebuttal','assumption','definition'],
  logic: ['supports','attacks','qualifies','elaborates','exemplifies','presupposes'],
  thinking: ['causes','enables','constrains','opposes','part_of','instance_of','depends_on'],
  gap: ['unstated_premise','leap','circularity','equivocation','overgeneralization','false_dichotomy','missing_evidence','other'],
  thinkingFacet: ['question','evidence_standard','reasoning_mode','assumption','worldview','lineage','normative','blind_spot','falsifier'],
  metaFacet: ['genre','audience','purpose','position','context','framing','silence'],
  literatureFacet: ['genre','audience','purpose','position','context','framing','silence','debate','contribution','other'],
  critiqueFacet: ['strength','weakness','evidence_quality','counterargument'],
  digestFacet: ['question','reasoning_mode'],
  citation: ['foundation','foil','method','evidence','context','ally'],
  question: ['comprehension','analysis','evaluation','debate'],
  across: ['theme','agreement','debate','method','gap','disagreement','concept_usage','reciprocal_reading'],
  criterion: ['question','method','data','findings','concepts','stance'],
  basis: ['stated','inferred'],
  part: ['claim','reason','strength','weakness','assumption','objection','assessment']
});
// A trailing ? means optional. Only these fields survive validation.
export const FIELDS = Object.freeze({
  meta: {lens:'short',lang:'short'},
  sum: {level:'enum:level',sec:'id?',text:'text',refs:'refs'},
  arc: {n:'number',stage:'enum:stage',text:'text',refs:'refs'},
  sec: {id:'id',parent:'id?',title:'text',role:'enum:role',gist:'text',span:'span'},
  node: {id:'id',kind:'enum:node',text:'text',refs:'refs',basis:'enum:basis',quote:'quote?'},
  edge: {from:'id',to:'id',rel:'relation',text:'text?'},
  step: {n:'number',text:'text',refs:'refs'},
  gap: {kind:'enum:gap',at:'ids',text:'text',refs:'refs'},
  facet: {kind:'facet',text:'text',refs:'refs',basis:'enum:basis'},
  concept: {id:'id',term:'text',src:'text?',gloss:'text',refs:'refs'},
  theme: {id:'id',label:'text',text:'text',refs:'refs'},
  code: {id:'id',theme:'id',label:'text',text:'text'},
  excerpt: {code:'id',ref:'reference',quote:'quote'},
  tension: {a:'id',b:'id',text:'text',refs:'refs'},
  memo: {text:'text'},
  cite: {who:'text',work:'text?',role:'enum:citation',text:'text',refs:'refs',url:'url?'},
  term: {src:'text',tr:'text',text:'text',refs:'refs'},
  q: {level:'enum:question',text:'text',refs:'refs'},
  note: {text:'text',refs:'refs?'},
  chk: {part:'enum:part',text:'text',refs:'refs',basis:'enum:basis?'},
  finding: {kind:'enum:across',text:'text',support:'text',refs:'refs'},
  cell: {item:'short',criterion:'enum:criterion',text:'text',refs:'refs'},
  end: {}
});
export const LENSES = Object.freeze({
  summary:['sum','arc','note'], structure:['sec','note'], logic:['node','edge','step','gap','note'],
  thinking:['facet','concept','edge','node','note'], themes:['theme','code','excerpt','tension','memo'],
  'meta-reading':['facet','note'], critique:['facet','note'], literature:['cite','facet','note'],
  'literature-review':['finding','note'], 'meta-synthesis':['cell','finding','note'],compare:['cell','finding','note','concept'],
  terms:['term'], questions:['q'], check:['chk'], passage:['note','term','node'], digest:['sum','node','concept','cite','facet']
});
export function customDefinition(value) {
  if(!value || value.version!==1 || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value.id) || typeof value.name!=='string' || !value.name.trim() || value.name.length>80 || typeof value.instructions!=='string' || !value.instructions.trim() || value.instructions.length>8000 || !['quick','analysis','book','synthesis'].includes(value.tier) || !Array.isArray(value.types) || !value.types.length || new Set(value.types).size!==value.types.length || value.types.some(t=>!Object.hasOwn(FIELDS,t) || ['meta','end'].includes(t)))throw Error('INVALID_CUSTOM_LENS');
  const has=t=>value.types.includes(t);if(has('edge')&&!has('node')&&!has('concept') || has('gap')&&!has('node') || has('code')&&!has('theme') || has('excerpt')&&(!has('code')||!has('theme')) || has('tension')&&!has('theme')&&!has('code'))throw Error('Custom links, codes and excerpts need their referenced record types too.');
  return {version:1,id:value.id,name:textValue(value.name,80),instructions:textValue(value.instructions,8000),tier:value.tier,types:[...value.types]};
}
export function safeURL(value) {try{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password && url.href.length<=2048?url.href:null;}catch{return null;}}
export function allowedTypes(lens,definition=null) {
  if(lens?.startsWith('custom:')){const custom=customDefinition(definition);if(lens!=='custom:'+custom.id)throw Error('CUSTOM_LENS_CHANGED');return ['meta',...custom.types,'end'];}
  if (!Object.hasOwn(LENSES,lens)) throw Error('UNKNOWN_LENS');
  return ['meta',...LENSES[lens],'end'];
}
export function enumeration(spec,lens) {
  if (spec.startsWith('enum:')) return ENUMS[spec.slice(5)];
  if (spec==='relation') return lens.startsWith('custom:')?[...new Set([...ENUMS.thinking,...ENUMS.logic])]:lens==='thinking' ? ENUMS.thinking : ENUMS.logic;
  if (spec==='facet') return lens.startsWith('custom:')?[...new Set([...ENUMS.thinkingFacet,...ENUMS.metaFacet,...ENUMS.critiqueFacet,...ENUMS.literatureFacet])]:({thinking:ENUMS.thinkingFacet,'meta-reading':ENUMS.metaFacet,literature:ENUMS.literatureFacet,critique:ENUMS.critiqueFacet,digest:ENUMS.digestFacet})[lens] ?? null;
  return null;
}
export const textValue = (value,cap=1200) => [...cleanText(value).normalize('NFC')].slice(0,cap).join('').trim();
export function validateFields(input,lens,definition=null) {
  if (!input || typeof input!=='object' || Array.isArray(input)) return {error:'object'};
  if (!allowedTypes(lens,definition).includes(input.t)) return {error:'type'};
  const record={t:input.t},flags=[];
  for (const [key,raw] of Object.entries(FIELDS[input.t])) {
    const optional=raw.endsWith('?'),spec=optional?raw.slice(0,-1):raw,value=input[key];
    const stringField=['text','quote','short','facet','id','relation','url'].includes(spec) || spec.startsWith('enum:');
    if (optional && (value==null || stringField && typeof value==='string' && !textValue(value))) continue;
    const values=enumeration(spec,lens);
    if(spec==='url') {const url=typeof value==='string'?safeURL(value):null;if(url)record[key]=url;else flags.push('url_omitted');}
    else if (values) {
      if (values.includes(value)) record[key]=value;
      else if (typeof value==='string' && values.includes('other')) {record[key]='other';flags.push('enum_other');}
      else return {error:'enum'};
    } else if (['text','quote','short','facet'].includes(spec)) {
      if (typeof value!=='string') return {error:'fields'};
      const cap=spec==='quote'?400:['short','facet'].includes(spec)?64:1200;
      record[key]=textValue(value,cap);
      if (!record[key]) return {error:'fields'};
      if (record[key]!==value) flags.push('text_sanitized');
    } else if (spec==='id') {
      if (typeof value!=='string' || !ID.test(value)) return {error:'identifier'};
      record[key]=value;
    } else if (spec==='number' || spec==='reference') {
      if (!Number.isSafeInteger(value) || spec==='number' && value<1) return {error:'fields'};
      record[key]=value;
    } else if (spec==='ids') {
      if (!Array.isArray(value) || !value.length || value.length>256 || value.some(id=>typeof id!=='string' || !ID.test(id))) return {error:'identifier'};
      record[key]=[...new Set(value)];
    } else if (spec==='refs' || spec==='span') {
      if (!Array.isArray(value) || value.length>10000 || value.some(n=>!Number.isSafeInteger(n)) || (spec==='span' && (value.length!==2 || value[0]>value[1]))) return {error:'references'};
      record[key]=spec==='span'?[...value]:[...new Set(value)];
    }
  }
  if (record.t==='meta' && record.lens!==lens) return {error:'meta'};
  if (lens==='digest' && record.t==='sum' && record.level!=='section') return {error:'enum'};
  return {record,flags:[...new Set(flags)]};
}
export function outputContract(lens,definition=null) {
  return JSON.stringify({format:'JSON Lines',recordTag:'t',types:Object.fromEntries(allowedTypes(lens,definition).map(t=>[t,{t:{type:'literal',value:t},...Object.fromEntries(Object.entries(FIELDS[t]).map(([k,s])=>[k,{type:s,values:enumeration(s.replace(/\?$/,''),lens)??undefined}]))}])),
    limits:{text:1200,quote:400,id:64},end:{t:'end'}});
}
// Stored records are already normalized. Check their canonical shape at trust boundaries,
// without rewriting missing failed quotes, unanchored spans, flags or previous IDs.
export function assertCanonicalRecords(entries,lens,{scope,sections,blocks,customLens=null}={}) {
  const allowed=allowedTypes(lens,customLens),ids=new Map();
  const fail=()=>{throw Error('INVALID_RETAINED_RECORD');};
  if(!Array.isArray(entries))fail();
  for(const entry of entries) {
    const r=entry?.record,flags=entry?.flags??[];
    if(!r || typeof r!=='object' || Array.isArray(r) || !allowed.includes(r.t) || ['meta','end'].includes(r.t) ||
      !Array.isArray(flags) || flags.some(f=>typeof f!=='string' || f.length>64) || !Number.isSafeInteger(entry.sequence) || entry.sequence<0)fail();
    if(['finding','cell'].includes(r.t)&&(!r.refs?.length||r.t==='cell'&&blocks&&r.refs.some(n=>blocks.find(b=>b.n===n)?.source?.itemId!==r.item)))fail();
    const fields=FIELDS[r.t];
    if(Object.keys(r).some(k=>k!=='t' && !Object.hasOwn(fields,k) && !(r.t==='sec' && k==='refs')))fail();
    for(const [key,raw] of Object.entries(fields)) {
      const optional=raw.endsWith('?'),spec=raw.replace(/\?$/,''),value=r[key],values=enumeration(spec,lens);
      if(value===undefined && (optional || key==='quote' && flags.includes('quotation_not_found') || spec==='reference' && flags.includes('unanchored')))continue;
      if(spec==='url') {if(safeURL(value)!==value)fail();}
      else if(values) {if(!values.includes(value))fail();}
      else if(['text','quote','short','facet'].includes(spec)) {
        const cap=spec==='quote'?400:['short','facet'].includes(spec)?64:1200;
        if(typeof value!=='string' || !value || !value.isWellFormed() || [...value].length>cap || textValue(value,cap)!==value)fail();
      } else if(spec==='id') {if(typeof value!=='string' || !ID.test(value))fail();}
      else if(spec==='number' || spec==='reference') {if(!Number.isSafeInteger(value) || value<1 || spec==='reference' && scope && !scope.has(value))fail();}
      else if(spec==='ids') {if(!Array.isArray(value) || !value.length || value.some(id=>typeof id!=='string' || !ID.test(id)))fail();}
      else if(spec==='refs') {if(!Array.isArray(value) || value.some(n=>!Number.isSafeInteger(n) || n<1 || scope && !scope.has(n)))fail();}
      else if(spec==='span') {
        if(!Array.isArray(value) || !(value.length===0 && flags.includes('unanchored') || value.length===2 && value.every(Number.isSafeInteger) && value[0]>0 && value[1]>=value[0]))fail();
      }
    }
    if(r.t==='sec' && (!Array.isArray(r.refs) || r.refs.some(n=>!Number.isSafeInteger(n) || n<1 || scope && !scope.has(n))))fail();
    if(r.id) {if(ids.has(r.id))fail();ids.set(r.id,r);}
  }
  const known=(id,types)=>types.includes(ids.get(id)?.t);
  for(const {record:r} of entries) {
    if(r.parent && !known(r.parent,['sec']) || r.t==='edge' && (!known(r.from,['node','concept']) || !known(r.to,['node','concept'])) ||
      r.t==='gap' && r.at.some(id=>!known(id,['node'])) || r.t==='code' && !known(r.theme,['theme']) || r.t==='excerpt' && !known(r.code,['code']) ||
      r.t==='tension' && [r.a,r.b].some(id=>!known(id,['theme','code'])) || r.sec && sections && !sections.some(s=>s.id===r.sec) && !known(r.sec,['sec']))fail();
  }
  const visited=new Set();
  for(const r of ids.values())if(r.t==='sec') {
    const path=new Set();let at=r;
    while(at && !visited.has(at.id)) {if(path.has(at.id))fail();path.add(at.id);at=ids.get(at.parent);}
    for(const id of path)visited.add(id);
  }
}
