import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {ReadingPreferences} from '../src/ui/preferences.mjs';
import {versionOf} from '../src/documents/model.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {createModelPicker} from '../extension/ui/model-picker.mjs';
import {createWorkspace} from '../extension/ui/workspace.mjs';
import {installSelectionToolbar} from '../extension/ui/passage-toolbar.mjs';
import {acceptPassage} from '../extension/ui/passage-handoff.mjs';
import {exampleDocument} from './helpers/document.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function dom(html='<main id="host"></main>') {
  const d=new JSDOM('<!doctype html><html><title>Review</title><body>'+html+'</body></html>',{url:'https://example.org/article',pretendToBeVisual:true});
  for(const key of ['document','CustomEvent','getSelection','requestAnimationFrame','cancelAnimationFrame','location'])globalThis[key]=typeof d.window[key]==='function'?d.window[key].bind(d.window):d.window[key];
  return d;
}
function memory(){let data={};return {async get(k){return {[k]:structuredClone(data[k])};},async set(v){data={...data,...structuredClone(v)};},async remove(k){delete data[k];}};}
const changes={addListener(){},removeListener(){}};
const provider={path:'seatline',provider:'claude',label:'Claude',available:true,signedIn:true,accepted:true,models:[],capabilities:{toolIsolation:true,effort:['low','medium','high'],serviceTier:['standard','fast']}};
const jsonl=(...records)=>records.map(r=>JSON.stringify(r)+'\n').join(''),end={t:'end'},note={t:'note',text:'A passage',refs:[5]},node={t:'node',id:'n',kind:'claim',text:'An argument',refs:[3],basis:'inferred'};
const field=(host,label)=>[...host.querySelectorAll('label')].find(el=>el.textContent.startsWith(label)).querySelector('input,select,textarea');
function choose(d,element,start=0,end=element.firstChild.length){const range=document.createRange();range.setStart(element.firstChild,start);range.setEnd(element.firstChild,end);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new d.window.Event('pointerup',{bubbles:true}));return range;}

test('provider-default effort/speed survive tier reloads, fresh discovery and appearance saves',async()=>{
  const d=dom(),storage=memory(),host=document.getElementById('host');let picker;
  try{
    picker=await createModelPicker(host,{storage,client:{call:async()=>[provider]}});await picker.ready;
    for(const tier of ['quick','analysis','book','synthesis']){
      await picker.setTier(tier);field(host,'Effort').value='';field(host,'Speed').value='';host.querySelector('button').click();await tick();
      const saved=(await storage.get('sharhReading')).sharhReading.tiers[tier];assert.equal(saved.effort,null);assert.equal(saved.serviceTier,null);
      await new ReadingPreferences(storage).save({theme:'ink',language:'uz'});await picker.setTier(tier);await picker.discover(true);
      assert.equal(field(host,'Effort').value,'');assert.equal(field(host,'Speed').value,'');assert.equal(picker.target.effort,null);
    }
  }finally{picker?.dispose();d.window.close();}
});

test('passages preserve the analysis tier, unsaved target and scope; an invalid Analyze budget cannot strand a passage',async()=>{
  const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
  const path=new FakePath({scripts:[{text:jsonl(note,end)},{text:jsonl(node,end)}],wait:async()=>{}});path.discover=async()=>[provider];
  const engine=new AnalysisEngine({store,paths:{seatline:path}});let workspace;
  try{
    workspace=await createWorkspace(document.getElementById('host'),{store,engine,client:{call:async()=>[provider]},storage,changes});await workspace.ready;await workspace.setDocument(doc);
    const root=document.querySelector('.workspace'),model=field(root,'Model ID'),tier=field(root,'Task tier'),budget=field(root,'Number of findings (1–200)');
    model.value='chapter-override';field(root,'Effort').value='high';field(root,'Speed').value='fast';const target=workspace.target,scope=workspace.selectionScope;budget.value='0';
    await assert.rejects(workspace.run(),/number of findings/);assert.equal(path.calls.length,0);let accepted=0;
    await workspace.passage('Explain',{spans:[{n:5,start:0,end:8}]},{onAccepted:()=>accepted++});assert.equal(accepted,1);
    assert.equal(path.calls[0].request.tier,'quick');assert.equal(path.calls[0].target.model,'haiku');assert.equal(path.calls[0].target.effort,'low');
    assert.equal(tier.value,'analysis');assert.deepEqual(workspace.target,target);assert.equal(workspace.selectionScope,scope);assert.equal(budget.value,'0');
    budget.value='12';field(root,'Lens').value='logic';await workspace.run();assert.equal(path.calls[1].request.tier,'analysis');assert.deepEqual(path.calls[1].target,target);
  }finally{workspace?.dispose();store.close();d.window.close();}
});

test('an active panel run retains the pending passage without switching documents or acknowledging it',async()=>{
  const storage=memory(),intent={id:'waiting',docId:'doc',version:'version'};await storage.set({pending:intent});let shown=false,lookups=0;
  await assert.rejects(acceptPassage({key:'pending',storage,isActive:()=>true,store:{async getDocument(){lookups++;}},show:()=>{shown=true;}}),/Stop the current run/);
  assert.equal(shown,false);assert.equal(lookups,0);assert.deepEqual((await storage.get('pending')).pending,intent);
});

test('a completed hidden workspace releases its controller without waiting for an animation frame',async()=>{
  const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
  const path=new FakePath({scripts:[{text:jsonl(node,end)}],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}});let workspace,running;const frames=[];
  try{
    workspace=await createWorkspace(document.getElementById('host'),{store,engine,client:{call:async()=>path.discover()},storage,changes});await workspace.ready;await workspace.setDocument(doc);
    field(document,'Lens').value='logic';globalThis.requestAnimationFrame=fn=>(frames.push(fn),frames.length);running=workspace.run();
    const result=await Promise.race([running,new Promise((_,reject)=>setTimeout(()=>reject(Error('Completion waited for rendering')),150))]);
    assert.equal(result.run.status,'completed');assert.equal(workspace.active,false);assert.match(document.querySelector('.run-state').textContent,/Completed/);assert.equal((await engine.list(doc.id)).length,1);
  }finally{for(let i=0;i<frames.length;i++)frames[i]();await running?.catch(()=>{});workspace?.dispose();store.close();d.window.close();}
});

test('alternate passage snapshots preserve the current article, run freshness, Library date and normal stale-scope guard',async()=>{
  const d=dom(),storage=memory(),store=await openDocumentStore({indexedDB:new IDBFactory()}),doc=await exampleDocument();await store.saveDocument(doc);
  const path=new FakePath({scripts:[{text:jsonl(node,end)},{text:jsonl(note,end)},{text:jsonl(node,end)}],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}}),target={path:'fake',provider:'fixture'};
  let workspace;
  try{
    const first=await engine.start({doc,scope:buildScope(doc),target,lens:'logic'}),current=await store.getDocument(doc.id),snapshot={...doc,version:await versionOf(doc.identity,'sidebar')};
    await store.saveDocument(snapshot,undefined,{makeCurrent:false});assert.deepEqual(await store.getDocument(doc.id),current);assert.equal((await engine.repository.get(first.run.id)).run.stale,false);
    await assert.rejects(engine.start({doc:snapshot,scope:buildScope(snapshot),target,lens:'passage'}),/STALE_SCOPE/);
    workspace=await createWorkspace(document.getElementById('host'),{store,engine,client:{call:async()=>path.discover()},storage,changes,surface:'tab'});await workspace.ready;await workspace.setDocument(snapshot);
    const passage=await workspace.passage('Explain',{spans:[{n:5,start:0,end:8}]});assert.equal(passage.run.extractionVersion,snapshot.version);
    assert.equal((await store.getDocument(doc.id)).version,doc.version);assert.equal((await engine.repository.get(first.run.id)).run.stale,false);
    const again=await engine.start({doc,scope:buildScope(doc),target,lens:'logic'});assert.equal(again.run.stale,false);
    [...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent==='Library').click();await tick();
    assert.ok(Number.isFinite((await store.listDocuments())[0].updatedAt));assert.doesNotMatch(document.querySelector('.library-documents article p').textContent,/·\s*$/);
    const archive=await store.exportData();const copy=await openDocumentStore({indexedDB:new IDBFactory()});try{await copy.importData(archive);assert.deepEqual(await copy.exportData(),archive);}finally{copy.close();}
  }finally{workspace?.dispose();store.close();d.window.close();}
});

test('toolbar defers extraction until a click, suppresses unchanged/editable selections and keeps Escape dismissed',async()=>{
  const d=dom('<main id="host"><p id="words">Selected words and context</p><textarea>Editable words</textarea></main>'),p=document.getElementById('words');let captures=0,resolves=0,checks=0;const calls=[];
  choose(d,p,0,8);const toolbar=installSelectionToolbar({document,enabled:async()=>{checks++;return true;},selection:()=>{captures++;return {range:getSelection().getRangeAt(0).cloneRange()};},resolveSelection:async value=>{resolves++;return {text:value.range.toString(),spans:[{n:2,start:0,end:8}]};},onAction:(action,value)=>calls.push({action,value})});
  try{
    await tick();const bar=document.querySelector('[role=toolbar]');assert.equal(bar.hidden,false);assert.equal(resolves,0);
    for(const key of ['c','Tab','Shift','Control','ArrowRight'])document.dispatchEvent(new d.window.KeyboardEvent('keyup',{key,ctrlKey:key==='c',bubbles:true}));document.dispatchEvent(new d.window.Event('pointerup'));await tick();assert.equal(captures,1);assert.equal(checks,1);
    document.dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'Escape'}));document.dispatchEvent(new d.window.KeyboardEvent('keyup',{key:'Escape'}));document.dispatchEvent(new d.window.Event('pointerup'));await tick();assert.equal(bar.hidden,true);
    choose(d,p,9,14);await tick();assert.equal(bar.hidden,false);assert.equal(checks,1);bar.querySelector('button').click();await tick();assert.equal(resolves,1);assert.equal(calls[0].value.text,'words');
    const input=document.querySelector('textarea');choose(d,input);await tick();assert.equal(bar.hidden,true);assert.equal(captures,2);
  }finally{toolbar.dispose();d.window.close();}
});

test('the content toolbar keeps extraction/spans together across explicit reader re-extraction and never replaces its scope cache',async()=>{
  const d=dom('<article><h1>Article</h1><p id="article">'+('Public evidence and a lengthy argument. '.repeat(30))+'</p></article><aside><p id="side">A visible sidebar appendix.</p></aside>');let listener;const calls=[],oldChrome=globalThis.chrome;
  // Open shadow roots only in this isolated DOM test so the production buttons can be activated.
  const attach=d.window.Element.prototype.attachShadow;d.window.Element.prototype.attachShadow=function(){return attach.call(this,{mode:'open'});};
  globalThis.chrome={storage:{local:{async get(){return {};}},onChanged:{addListener(){}}},runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},async sendMessage(message){calls.push(message);return {result:true};}}};delete globalThis.__sharhReader;
  const send=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));
  try{
    await import('../extension/content/reader.mjs?review');const article=await send({type:'sharh:reader:extract',mode:'article'});assert.ok(article.result.extraction.blocks.length);
    choose(d,document.getElementById('side'));await tick();const bar=document.querySelector('[data-sharh-toolbar]').shadowRoot.querySelector('[role=toolbar]');assert.equal(bar.hidden,false);
    const unchanged=await send({type:'sharh:reader:selection',version:article.result.extraction.version});assert.equal(unchanged.error,undefined);
    // The visible toolbar captures article mode; a later reader extract cannot change that intention.
    await send({type:'sharh:reader:extract',mode:'whole'});bar.querySelector('button').click();await tick();
    const invoked=calls.find(m=>m.type==='sharh:passage:invoke');assert.ok(invoked);assert.equal(invoked.extraction.includeNavigation,true);
    const selected=buildScope({...invoked.extraction,kind:'html'},{kind:'selection',spans:invoked.selection.spans});assert.ok(selected.blocks.some(b=>b.selected && b.text==='A visible sidebar appendix.'));
    const fresh=await send({type:'sharh:reader:extract',mode:'article'});choose(d,document.getElementById('article'),0,12);await tick();const selection=await send({type:'sharh:reader:selection',version:fresh.result.extraction.version});assert.ok(selection.result.spans.length);assert.equal(selection.error,undefined);
  }finally{globalThis.chrome=oldChrome;delete globalThis.__sharhReader;d.window.close();}
});

test('late toolbar permission/selection work cannot replace or hide the winning captured selection',async()=>{
  const d=dom('<p id="words">First second</p>'),p=document.getElementById('words'),pending=[],calls=[];
  choose(d,p,0,5);const toolbar=installSelectionToolbar({document,enabled:()=>new Promise(resolve=>pending.push(resolve)),selection:range=>({spans:[{n:range.toString()==='First'?1:2,start:0,end:range.toString().length}]}),onAction:(_,selection)=>calls.push(selection)});
  try{
    await tick();choose(d,p,6,12);await tick();assert.equal(pending.length,2);pending[1](true);await tick();const bar=document.querySelector('[role=toolbar]');assert.equal(bar.hidden,false);assert.match(bar.textContent,/¶2/);
    pending[0](true);await tick();assert.equal(bar.hidden,false);assert.match(bar.textContent,/¶2/);bar.querySelector('button').click();await tick();assert.equal(calls[0].spans[0].n,2);
  }finally{toolbar.dispose();d.window.close();}
});
