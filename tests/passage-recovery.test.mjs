import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {outputContract,allowedTypes,validateFields} from '../src/analysis/contract.mjs';
import {assemblePrompt} from '../src/analysis/prompts.mjs';
import {buildScope,serializeScope} from '../src/documents/scopes.mjs';
import {versionOf} from '../src/documents/model.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {createWorkspace} from '../extension/ui/workspace.mjs';
import {installSelectionToolbar} from '../extension/ui/passage-toolbar.mjs';
import {exampleDocument} from './helpers/document.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5)),changes={addListener(){},removeListener(){}};
const info={path:'seatline',provider:'claude',available:true,signedIn:true,accepted:true,models:[],capabilities:{streaming:true,sessions:false,toolIsolation:true,effort:['low','medium','high']}};
function memory(){let data={sharhReading:{language:'uz-Latn',tiers:{analysis:{path:'seatline',provider:'claude',model:'sonnet',effort:'medium'}}}};return {async get(k){return {[k]:structuredClone(data[k])};},async set(v){data={...data,...structuredClone(v)};}};}
function dom(){const d=new JSDOM('<!doctype html><body><p id="source"></p><main id="host"></main>',{url:'https://example.org',pretendToBeVisual:true});for(const k of ['document','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','location'])globalThis[k]=typeof d.window[k]==='function'?d.window[k].bind(d.window):d.window[k];return d;}
// Follow the advertised record shape: no hard-coded type discriminator here.
function shaped(shape,values){return Object.fromEntries(Object.entries(shape).filter(([key,spec])=>!spec.type.endsWith('?')).map(([key,spec])=>[key,spec.type==='literal'?spec.value:values[key]]));}
function answer(request){
  const task=JSON.parse(request.task.split('\n')[1]),contract=JSON.parse(request.task.split('SHARH_OUTPUT_CONTRACT\n')[1]),data=JSON.parse(request.document),block=data.blocks.find(b=>b.selected),n=block.n;
  const type=task.lens==='logic'?'node':'note',values={id:'n1',kind:'claim',text:block.selected.map(s=>s.text).join(' / '),refs:[n],basis:'inferred'};
  const record=shaped(contract.types[type],values);if(type==='note')record.refs=[n];return {text:[record,shaped(contract.types.end,{})].map(JSON.stringify).join('\n')+'\n'};
}
async function fixture(scriptFor=({request})=>answer(request)){
  const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);document.getElementById('source').textContent=doc.blocks[4].text;
  const path=new FakePath({scriptFor,sessions:false,wait:async()=>{}});path.discover=async()=>[info];const engine=new AnalysisEngine({store,paths:{seatline:path}}),client={call:async m=>m==='discover'?[info]:null};
  const workspace=await createWorkspace(document.getElementById('host'),{store,engine,client,storage,changes});await workspace.ready;await workspace.setDocument(doc);
  return {d,storage,store,doc,path,engine,client,workspace,close(){workspace.dispose();store.close();d.window.close();}};
}
function select(d,start,end){const r=document.createRange();r.setStart(document.getElementById('source').firstChild,start);r.setEnd(document.getElementById('source').firstChild,end);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));}

test('every advertised record shape explicitly requires its literal t discriminator',()=>{
  for(const lens of ['passage','logic','summary','structure','thinking']){
    const contract=JSON.parse(outputContract(lens));assert.equal(contract.recordTag,'t');
    for(const type of allowedTypes(lens))assert.deepEqual(contract.types[type].t,{type:'literal',value:type});
  }
  const shape=JSON.parse(outputContract('passage')).types.note,record=shaped(shape,{text:'An explanation'});assert.equal(validateFields(record,'passage').record.t,'note');
  const {t,...ambiguous}=record;assert.equal(validateFields(ambiguous,'passage').error,'type');
});

test('selection requests contain exact source text for each UTF-16 span while retaining paragraph context',async()=>{
  const doc=await exampleDocument();doc.blocks[4].text='😀 Before αβ and بعد selection';const text=doc.blocks[4].text,a=text.indexOf('αβ'),b=text.indexOf('بعد'),scope=buildScope(doc,{kind:'selection',spans:[{n:5,start:a,end:a+2},{n:5,start:b,end:b+3}]}),wire=JSON.parse(serializeScope(doc,scope)),selected=wire.blocks.find(b=>b.n===5);
  assert.equal(selected.text,text);assert.deepEqual(selected.selected,[{start:a,end:a+2,text:'αβ'},{start:b,end:b+3,text:'بعد'}]);assert.ok(wire.blocks.some(b=>b.context && !b.selected));assert.deepEqual(scope.blocks.find(b=>b.n===5).selected,[{start:a,end:a+2},{start:b,end:b+3}]);
  const prompt=assemblePrompt(doc,scope,{lens:'passage',action:'Translate'});assert.match(prompt.request.rules,/selected\[\]\.text/);assert.match(prompt.request.rules,/UTF-16/);
});

test('mouse-clicking all four passage actions completes through the Quick target using the advertised contract',async()=>{
  const w=await fixture();let done;
  const toolbar=installSelectionToolbar({document,selection:range=>({spans:[{n:5,start:range.startOffset,end:range.endOffset}]}),onAction:(action,selection)=>{done=w.workspace.passage(action,selection);return done;}});
  try{for(const [i,action]of ['Explain','Translate','Logic','Define'].entries()){
    done=null;select(w.d,i,i+8);await tick();document.querySelectorAll('[role=toolbar] button')[i].click();await tick();assert.ok(done);const saved=await done;
    assert.equal(saved.run.status,'completed');assert.equal(saved.run.config.action,action);assert.equal(saved.run.target.model,'haiku');assert.equal(saved.run.config.tier,'quick');assert.equal(saved.records[0].record.text,w.doc.blocks[4].text.slice(i,i+8).trim());
  }assert.equal(w.path.calls.length,4);assert.match(document.querySelector('.run-state').textContent,/Completed/);
  }finally{toolbar.dispose();w.close();}
});

test('invalid Quick output explains rejection, survives reopening, and retries the saved passage with the selected model',async()=>{
  const bad={text:'{"text":"Missing record tag","refs":[5]}\n{"t":"end"}\n'},w=await fixture(({target,request})=>target.model==='haiku'?bad:answer(request));let workspace=w.workspace;
  try{const failed=await workspace.passage('Translate',{spans:[{n:5,start:2,end:12}]});assert.equal(failed.run.status,'invalid');assert.equal(w.path.calls.length,2);assert.equal(failed.run.attempts.length,2);
    assert.match(document.querySelector('.run-state').textContent,/Response format failed/);assert.match(document.querySelector('.run-diagnostics').textContent,/missing or unsupported record type/);assert.equal(document.querySelector('.run-diagnostics').hidden,false);
    await w.engine.repository.write(failed.run.id,{promptVersion:'analysis-3'});
    const updated=structuredClone(w.doc);updated.version=await versionOf(w.doc.identity,'newer extraction');updated.blocks[4].text='Changed source text in a newer extraction';updated.blocks[4].anchor.quote.exact=updated.blocks[4].text;updated.blocks[4].anchor.position.end=updated.blocks[4].anchor.position.start+updated.blocks[4].text.length;await w.store.saveDocument(updated);
    workspace.dispose();workspace=await createWorkspace(document.getElementById('host'),{store:w.store,engine:w.engine,client:w.client,storage:w.storage,changes});await workspace.ready;await workspace.setDocument(updated);
    assert.equal(w.path.calls.length,2);assert.match(document.querySelector('.run-state').textContent,/Response format failed/);assert.equal(workspace.selectionScope.kind,'document');
    const retry=[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry with selected model');assert.equal(retry.hidden,false);retry.click();
    for(let i=0;i<100 && w.path.calls.length<3;i++)await tick();for(let i=0;i<100 && workspace.active;i++)await tick();
    assert.equal(w.path.calls.length,3);const call=w.path.calls[2],task=JSON.parse(call.request.task.split('\n')[1]),data=JSON.parse(call.request.document),rows=await w.engine.list(w.doc.id),recovered=await w.engine.repository.get(rows[0].id);
    assert.equal(call.target.model,'sonnet');assert.equal(call.target.effort,'medium');assert.equal(call.request.tier,'analysis');assert.equal(task.action,'Translate');assert.equal(task.outputLanguage,'uz-Latn');assert.equal(data.blocks.find(b=>b.n===5).selected[0].text,w.doc.blocks[4].text.slice(2,12));
    assert.equal(recovered.run.status,'completed');assert.equal(recovered.run.promptVersion,'analysis-4');assert.equal(recovered.run.extractionVersion,w.doc.version);assert.equal(recovered.run.stale,true);assert.equal((await w.engine.repository.get(failed.run.id)).run.status,'invalid');assert.equal(rows.length,2);
    assert.equal(retry.hidden,true);assert.equal(document.querySelector('.run-diagnostics').hidden,true);assert.equal(workspace.selectionScope.kind,'document');
  }finally{workspace.dispose();w.close();}
});
