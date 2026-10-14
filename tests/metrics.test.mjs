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
