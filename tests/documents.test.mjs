import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,versionOf,validateDocument} from '../src/documents/model.mjs';
import {buildScope,serializeScope,scopeRequest,scopeSize} from '../src/documents/scopes.mjs';
import {generationFrame,SeatlinePath} from '../src/paths/seatline.mjs';
import {measureRequest,MAX_REQUEST_BYTES} from '../src/paths/limits.mjs';
import {exampleDocument} from './helpers/document.mjs';
test('document identities, extraction versions and model validation keep numbering and section trees sound',async()=> {
  const a=await exampleDocument(), b=await exampleDocument('https://example.org/other');
  assert.notEqual(a.id,b.id); assert.notEqual(a.version,b.version);
  assert.equal(validateDocument(structuredClone(a)).id,a.id);
  for (const mutate of [d=>d.blocks[1].n=1,d=>d.sections[0].parent='s2',d=>d.sections[1].last=99,d=>d.blocks[2].anchor.quote.exact='forged']) {
    const invalid=structuredClone(a); mutate(invalid); assert.throws(()=>validateDocument(invalid));
  }
});
test('selection scopes preserve partial offsets, heading and two-before/one-after context without renumbering',async()=> {
  const doc=await exampleDocument(), choice={kind:'selection',spans:[{n:5,start:9,end:15}]}, scope=buildScope(doc,choice);
  assert.deepEqual(scope.blocks.map(b=>b.n),[2,3,4,5,6]);
  assert.deepEqual(scope.blocks.filter(b=>b.context).map(b=>b.n),[2,3,4,6]);
  assert.deepEqual(scope.blocks.find(b=>b.n===5).selected,[{start:9,end:15}]);
  const serialized=JSON.parse(serializeScope(doc,scope)); assert.equal(serialized.lang,'uz'); assert.equal(serialized.blocks[3].text,'Selected public evidence.');
  assert.equal(buildScope(doc,{kind:'section',id:'s2'}).blocks[0].n,2);
  assert.equal(buildScope(doc,{kind:'chapter',id:'s1'}).blocks.length,7);
  assert.throws(()=>buildScope(doc,{kind:'chapter',id:'s2'}),/NOT_FOUND/);
  assert.equal(buildScope(doc,{kind:'chapter',id:'s2',level:2}).blocks[0].n,2);
  for(const spans of [[],[{n:0,start:0,end:2}],[{n:3,start:-1,end:2}],[{n:3,start:0,end:1000}]]) assert.throws(()=>buildScope(doc,{kind:'selection',spans}));
  assert.throws(()=>serializeScope({...doc,version:'changed'},scope),/STALE/);
});
test('PDF page scopes use physical indices and retain printed labels and notes',async()=> {
  const doc=await exampleDocument(); doc.kind='pdf'; doc.pageCount=3; doc.pageLabels=['iv','41','42'];
  doc.blocks.forEach((b,i)=>{b.page=Math.min(2,Math.floor(i/2)); b.pageLabel=doc.pageLabels[b.page];});
  const scope=buildScope(doc,{kind:'pages',first:1,last:2});
  assert.equal(scope.blocks[0].n,3); assert.match(scope.label,/41–42/);
  for (const [first,last] of [[-1,1],[1,0],[0,3],[.5,1]]) assert.throws(()=>buildScope(doc,{kind:'pages',first,last}),/INVALID_PAGE/);
});
test('scope size includes exact multilingual/escaped protected-frame bytes and the path refuses overflow before connecting',async()=> {
  const doc=await exampleDocument(); doc.blocks[4].text='«Oʻzbek» \"Привет\" العربية 😀 \n \\'.repeat(100);
  const scope=buildScope(doc), target={path:'seatline',provider:'codex',model:'model-id',effort:'high',serviceTier:'fast'}, request={rules:'Rules «quoted»',task:'Read 😀',history:[{role:'assistant',text:'Earlier'}]};
  const sized=scopeSize(doc,scope,{target,request}), frame=generationFrame(target,scopeRequest(doc,scope,request));
  assert.equal(sized.requestBytes,Buffer.byteLength(JSON.stringify(frame),'utf8'));
  assert.equal(sized.requestBytes,measureRequest(frame)); assert.ok(sized.estimatedTokens>0);
  const base=scopeSize(doc,scope,{target,request:{...request,task:'a'}}).requestBytes;
  const task='a'.repeat(MAX_REQUEST_BYTES-base+1);
  assert.equal(scopeSize(doc,scope,{target,request:{...request,task}}).requestBytes,MAX_REQUEST_BYTES);
  assert.equal(scopeSize(doc,scope,{target,request:{...request,task}}).fits,true);
  assert.equal(scopeSize(doc,scope,{target,request:{...request,task:task+'a'}}).fits,false);
  let connections=0; const path=new SeatlinePath({connectNative:()=>{connections++;throw Error('must not connect');}});
  await assert.rejects(path.run(target,scopeRequest(doc,scope,{...request,task:task+'a'})),{code:'TOO_LARGE'});
  assert.equal(connections,0);
});
