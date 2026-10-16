import {allowedTypes,validateFields,assertCanonicalRecords} from './contract.mjs';
import {QuotationIndex} from './quotes.mjs';
import {bytes} from '../paths/limits.mjs';

// An argument check has one claim and one assessment, and a few of the rest.
// A deep reading has one synthesis, a short outline and a few open questions beside its argument check.
const DEEP_LIMITS=Object.freeze({sum:1,sec:8,q:3});
const CHK_LIMITS=Object.freeze({claim:1,reason:3,strength:1,weakness:1,assumption:2,objection:1,assessment:1});
const deferred = r => ['edge','gap','code','excerpt','tension'].includes(r.t) || r.parent!==undefined || r.sec!==undefined;
export class RecordParser {
  constructor({lens,blocks,sections=[],onRecord=()=>{},now=()=>performance.now(),maxBytes=524288,maxLineBytes=65536,customLens=null,sources=new Map()}) {
    allowedTypes(lens,customLens);
    Object.assign(this,{lens,blocks,sections,onRecord,now,maxBytes,maxLineBytes,customLens,sources});
    this.started=now(); this.buffer=''; this.entries=[]; this.ids=new Map(); this.pending=[];
    this.scope=new Set(blocks.map(b=>b.n)); this.numbers=[...this.scope].sort((a,b)=>a-b);
    this.quotes=new QuotationIndex(blocks); this.endReceived=false; this.afterEnd=false; this.finished=false;
    this.sequenceBase=0;
    this.metrics={lines:0,recordLines:0,validRecords:0,newValidRecords:0,retainedRecords:0,dropped:{},skipped:{},referencesRemoved:0,quotationsVerified:0,quotationsFailed:0,
      duplicateIdentifiers:0,danglingIdentifiers:0,parentCycles:0,timeToFirstRecordMs:null,totalMs:0,outputBytes:0,truncated:true};
  }
  count(group,reason,n=1) { this.metrics[group][reason]=(this.metrics[group][reason]??0)+n; }
  seed(entries) {
    if(this.metrics.lines || this.buffer)throw Error('SEED_MUST_BE_FIRST');
    assertCanonicalRecords(entries,this.lens,{scope:this.scope,sections:this.sections,blocks:this.blocks,customLens:this.customLens});
    const retained=entries.map((entry,i)=>({sequence:i+1,record:structuredClone(entry.record),flags:[...(entry.flags??[])],retained:true}));
    for(const entry of retained)if(entry.record.id)this.ids.set(entry.record.id,entry);
    for(const entry of retained)this.emit(entry);
    this.sequenceBase=retained.length;
  }
  push(text) {
    if(this.finished)throw Error('PARSER_FINISHED');
    if(typeof text!=='string')throw Error('INVALID_DELTA');
    if(this.capped)return;
    this.metrics.outputBytes+=bytes(text);
    if(this.metrics.outputBytes>this.maxBytes) {this.capped=true;this.buffer='';this.count('dropped','output_limit');return;}
    this.buffer+=text;
    let start=0,end;
    while((end=this.buffer.indexOf('\n',start))>=0) {this.line(this.buffer.slice(start,end));start=end+1;}
    this.buffer=this.buffer.slice(start);
    if(bytes(this.buffer)>this.maxLineBytes) {this.discarding=true;this.buffer='';}
  }
  line(raw) {
    this.metrics.lines++;
    if(this.discarding) {this.discarding=false;this.metrics.recordLines++;this.count('dropped','line_limit');return;}
    const line=raw.trim();
    if(!line) {this.count('skipped','empty');return;}
    if(/^```/.test(line)) {this.count('skipped','fence');return;}
    if(this.endReceived) {this.afterEnd=true;this.count('skipped','after_end');return;}
    this.metrics.recordLines++;
    if(bytes(line)>this.maxLineBytes) {this.count('dropped','line_limit');return;}
    if(!line.startsWith('{')) {this.count('skipped','prose');this.count('dropped','framing');return;}
    let input;
    try {input=JSON.parse(line);} catch {this.count('dropped','parse');return;}
    const {record:r,flags,error}=validateFields(input,this.lens,this.customLens);
    if(error) {this.count('dropped',error);return;}
    if(r.t==='meta') {
      if(this.meta || this.metrics.recordLines!==1) {this.count('dropped','meta_order');return;}
      this.meta=r;this.metrics.recordLines--;return;
    }
    if(r.t==='end') {this.endReceived=true;this.metrics.recordLines--;return;}
    if(this.lens==='deep'&&DEEP_LIMITS[r.t]&&this.entries.filter(e=>e.record.t===r.t).length>=DEEP_LIMITS[r.t]){this.count('dropped','limit');return;}
    if(this.lens==='ideas'&&r.t==='theme'&&this.entries.filter(e=>e.record.t==='theme').length>=5){this.count('dropped','limit');return;}
    if(r.t==='chk'&&this.entries.filter(e=>e.record.t==='chk'&&e.record.part===r.part).length>=CHK_LIMITS[r.part]){this.count('dropped','limit');return;}
    const entry={sequence:this.sequenceBase+this.metrics.lines,record:r,flags};
    if(r.refs) {
      const before=r.refs.length;r.refs=r.refs.filter(n=>this.scope.has(n));
      this.metrics.referencesRemoved+=before-r.refs.length;
      if(!r.refs.length && r.t!=='note')flags.push('unanchored');
    }
    if(['finding','cell'].includes(r.t)&&(!r.refs?.length||r.t==='cell'&&r.refs.some(n=>this.blocks.find(b=>b.n===n)?.source?.itemId!==r.item))){this.count('dropped','source_reference');return;}
    if(r.ref!==undefined && !this.scope.has(r.ref)) {delete r.ref;flags.push('unanchored');this.metrics.referencesRemoved++;}
    if(r.span) {
      const [a,b]=r.span,within=this.numbers.filter(n=>n>=a && n<=b);
      this.metrics.referencesRemoved+=Number(!this.scope.has(a))+Number(!this.scope.has(b));
      r.span=within.length?[within[0],within.at(-1)]:[];
      // A selection can be noncontiguous. Explicit refs prevent inventing anchors in its gaps.
      r.refs=within;
      if(!within.length)flags.push('unanchored');
    }
    if(r.quote) {
      if(this.quotes.verify(r.quote,r.refs??(r.ref===undefined?[]:[r.ref])))this.metrics.quotationsVerified++;
      else {delete r.quote;flags.push('quotation_not_found');this.metrics.quotationsFailed++;}
    }
    if(r.id) {
      const original=r.id;
      if(this.ids.has(original)) {
        let suffix=2;
        do {r.id=`${original.slice(0,54)}_dup${suffix++}`;}while(this.ids.has(r.id));
        flags.push('duplicate_id');this.metrics.duplicateIdentifiers++;
      }
      this.ids.set(r.id,entry);
    }
    if(deferred(r))this.pending.push(entry);else this.emit(entry);
  }
  emit(entry) {
    entry.flags=[...new Set(entry.flags)];this.entries.push(entry);this.metrics.validRecords++;
    if(entry.retained)this.metrics.retainedRecords++;
    else {this.metrics.newValidRecords++;this.metrics.timeToFirstRecordMs??=this.now()-this.started;}
    try {this.onRecord(structuredClone(entry));}catch{/* Observers cannot invalidate model data. */}
  }
  resolve() {
    const known=(id,types)=>types.includes(this.ids.get(id)?.record.t);
    for(const entry of this.pending) {
      const r=entry.record;let valid=true;
      const require=(id,types)=> {if(known(id,types))return true;this.metrics.danglingIdentifiers++;return false;};
      if(r.t==='edge')valid=require(r.from,['node','concept']) && require(r.to,['node','concept']);
      if(r.t==='gap') {r.at=r.at.filter(id=>require(id,['node']));valid=!!r.at.length;}
      if(r.t==='code')valid=require(r.theme,['theme']);
      if(r.t==='excerpt')valid=require(r.code,['code']);
      if(r.t==='tension')valid=require(r.a,['theme','code']) && require(r.b,['theme','code']);
      if(r.parent && !require(r.parent,['sec'])) {delete r.parent;entry.flags.push('dangling_parent');}
      if(r.sec && !known(r.sec,['sec']) && !this.sections.some(s=>s.id===r.sec)) {delete r.sec;entry.flags.push('dangling_section');this.metrics.danglingIdentifiers++;}
      if(!valid) {entry.invalid=true;this.count('dropped','dangling_identifier');}
    }
    // Dependants of an invalid code cannot survive merely because its ID was parsed.
    for(const entry of this.pending)if(!entry.invalid && (entry.record.t==='excerpt' && this.ids.get(entry.record.code)?.invalid || entry.record.t==='tension' && [entry.record.a,entry.record.b].some(id=>this.ids.get(id)?.invalid))) {
      entry.invalid=true;this.count('dropped','dangling_identifier');this.metrics.danglingIdentifiers++;
    }
    const visited=new Set();
    for(const entry of this.pending.filter(e=>e.record.t==='sec')) {
      const path=new Set();let at=entry;
      while(at && !visited.has(at.record.id)) {
        const id=at.record.id;path.add(id);
        if(path.has(at.record.parent)) {delete at.record.parent;at.flags.push('parent_cycle');this.metrics.parentCycles++;break;}
        at=this.ids.get(at.record.parent);
      }
      for(const id of path)visited.add(id);
    }
    for(const entry of this.pending)if(!entry.invalid)this.emit(entry);
    this.pending=[];
  }
  finish({truncated=false,usage=null}={}) {
    if(this.finished)return this.result;
    if(this.discarding && !this.buffer)this.line('');
    else if(this.buffer.trim())this.line(this.buffer);
    this.buffer='';this.resolve();this.finished=true;
    for(const entry of this.entries)if(entry.record.url){entry.flags=entry.flags.filter(f=>!['source_verified','source_not_returned'].includes(f));entry.flags.push(this.sources.has(entry.record.url)?'source_verified':'source_not_returned');}
    this.metrics.truncated=truncated || this.capped===true || !this.endReceived;
    this.metrics.totalMs=this.now()-this.started;this.metrics.usage=usage;
    this.metrics.emptyCompletion=this.metrics.recordLines===0 && this.endReceived && !this.metrics.truncated;
    this.metrics.validRate=this.metrics.recordLines?this.metrics.newValidRecords/this.metrics.recordLines:this.metrics.emptyCompletion?1:0;
    this.result={records:this.entries.sort((a,b)=>a.sequence-b.sequence),metrics:structuredClone(this.metrics),meta:this.meta??null};
    return this.result;
  }
}
