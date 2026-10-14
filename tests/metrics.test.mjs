import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputMetrics,verifyQuote} from '../scripts/lib/output-metrics.mjs';
import {standInOutput} from '../scripts/lib/draft-prompts.mjs';
const blocks=[{n:1,kind:'heading',text:'Access'},{n:2,kind:'para',text:'Oʻqish — a public good.'},{n:3,kind:'para',text:'Residents use the library.'},{n:8,kind:'para',text:'An unrelated end.'}];
test('arbitrarily chunked JSONL preserves records, refs, quotation and first-record timing',()=>{
  let time=10;
  const m=new OutputMetrics({lens:'logic',blocks,now:()=>time++});
  const text=standInOutput('logic',{blocks});
  for (let i=0;i<text.length;i+=3) m.push(text.slice(i,i+3));
  const r=m.finish(); assert.equal(r.parseRate,1); assert.equal(r.referenceValidity,1); assert.equal(r.quotationVerification,1); assert.equal(r.completed,true); assert.ok(r.timeToFirstRecordMs>0);
});
test('invalid refs, malformed lines, fences, forged quotes, duplicate ids and truncation are reported',()=>{
  const m=new OutputMetrics({lens:'logic',blocks,canary:'SECRET_CANARY'});
  m.push('```json\n{bad}\n'+JSON.stringify({t:'node',id:'n',kind:'claim',text:'SECRET_CANARY',refs:[0,2,9000],basis:'stated',quote:'words never stated'})+'\n'+JSON.stringify({t:'edge',from:'n',to:'missing',rel:'supports'})+'\n'+JSON.stringify({t:'node',id:'n',kind:'claim',text:'claim',refs:[2],basis:'stated'}));
  const r=m.finish(); assert.equal(r.lines,5); assert.equal(r.validRecords,3); assert.equal(r.referenceValidity,.5); assert.equal(r.verifiedQuotations,0); assert.equal(r.danglingIdentifiers,1); assert.equal(r.duplicateIdentifiers,1); assert.equal(r.truncated,true); assert.equal(r.canaryObserved,true);
});
test('schema validity, completion order and parent cycles are measured',()=>{
  const m=new OutputMetrics({lens:'structure',blocks});
  for (const r of [{t:'sec',id:'s',parent:'s',title:'Access',role:'claim',gist:'role',span:[1,3]},{t:'sec',id:'wrong',title:'Bad',role:'invented',gist:'bad',span:[1,3]},{t:'end'},{t:'note',text:'after end'}]) m.push(JSON.stringify(r)+'\n');
  const r=m.finish(); assert.equal(r.parentCycle,true); assert.equal(r.completed,false); assert.equal(r.failures.schema,1); assert.equal(r.headingCoverage,1);
});
test('quotation normalization works across supported scripts and adjacent paragraphs only',()=>{
  assert.ok(verifyQuote("O'qish - a public good.",[2],blocks));
  assert.ok(verifyQuote('public good. Residents use',[2],blocks));
  assert.ok(verifyQuote('Oʻqish…public good',[2],blocks));
  assert.equal(verifyQuote('public good. An unrelated end.',[2,8],blocks),false);
  for (const text of ['Привет мир','Ўқиш яхши','Okumak iyidir','القراءة مفيدة']) assert.ok(verifyQuote(text,[1],[{n:1,text}]));
  assert.equal(verifyQuote('…',[2],blocks),false);
});
test('all advertised text limits reject overlong records, including optional text and quotes',()=>{
  const cases=[['logic',{t:'node',id:'n',kind:'claim',text:'x'.repeat(1201),refs:[2],basis:'stated'}],['logic',{t:'step',n:1,text:'x'.repeat(1500),refs:[2]}],['logic',{t:'gap',kind:'other',at:['n'],text:'x'.repeat(1201),refs:[2]}],['logic',{t:'note',text:'x'.repeat(1201)}],['logic',{t:'edge',from:'a',to:'b',rel:'supports',text:'x'.repeat(1201)}],['structure',{t:'sec',id:'s',title:'a',gist:'x'.repeat(3000),role:'claim',span:[1,3]}],['structure',{t:'sec',id:'s',title:'x'.repeat(1201),gist:'a',role:'claim',span:[1,3]}],['logic',{t:'node',id:'n',kind:'claim',text:'short',refs:[2],basis:'stated',quote:'x'.repeat(401)}]];
  for(const [lens,record] of cases){const m=new OutputMetrics({lens,blocks});m.push(JSON.stringify(record)+'\n{"t":"end"}\n');const r=m.finish();assert.equal(r.validRecords,1);assert.equal(r.failures.schema,1);assert.equal(r.parseRate,.5);}
  const m=new OutputMetrics({lens:'logic',blocks});m.push(JSON.stringify({t:'node',id:'n',kind:'claim',text:'🙂'.repeat(1200),refs:[2],basis:'stated'})+'\n');assert.equal(m.finish().validRecords,1);
});
test('quote verification permits a cited-boundary crossing and refuses a quote solely from a neighbour',()=>{
  assert.equal(verifyQuote('Residents use the library.',[2],blocks),false);
  assert.equal(verifyQuote('public good. Residents use',[2],blocks),true);
});
test('meta must be first and headingless scopes have no heading coverage requirement',()=>{
  const m=new OutputMetrics({lens:'structure',blocks:blocks.filter(b=>b.kind!=='heading')});
  m.push('{"t":"note","text":"a note"}\n{"t":"meta","lens":"structure","lang":"en"}\n{"t":"end"}\n');
  const r=m.finish();assert.equal(r.failures.meta_order,1);assert.equal(r.headingCoverage,null);
});
test('an identical uncited neighbour does not hide the legitimate cited occurrence of a quote',()=>{
  assert.equal(verifyQuote('Repeated finding.',[2],[{n:1,text:'Repeated finding.'},{n:2,text:'Repeated finding.'}]),true);
});
