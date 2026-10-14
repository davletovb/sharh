import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {extractHTML,resolveHTMLAnchor,selectedHTMLBlocks} from '../src/readers/html.mjs';
import {textMap} from '../src/readers/html-text.mjs';
import {extractPDFBlocks,outlineSections} from '../src/readers/pdf-layout.mjs';
import {createDocument,normalizeText,normalizePDFText,pdfTextOffsets,versionOf,makeSections} from '../src/documents/model.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {equalData} from '../src/documents/archive.mjs';
import {bindScopePicker} from '../extension/ui/scope-picker.mjs';
import {exampleDocument} from './helpers/document.mjs';
const paragraph='Public libraries need reliable observations and careful interpretation. A count of visits does not explain why the number changed. Comparing independent sources makes that uncertainty visible. '.repeat(3);
test('web extraction tolerates excluded/pruned inline nodes and unmarked BR paragraphs in every mode',async()=> {
  for(const inline of ['<span aria-hidden="true">★</span>','<span hidden>hidden</span>','<script>untrusted()</script>','<span class="social-share">Share me</span>']) {
    const dom=new JSDOM(`<article id="a"><h1>Title</h1><p>Hello ${inline} world. ${paragraph}</p><ul><li>Before <aside>Omit me</aside> after. ${paragraph}</li></ul></article>`,{url:'https://example.org/'});
    try {for(const mode of ['article','whole','region']) {
      const doc=await extractHTML(dom.window.document,{mode,region:'#a'});
      assert.ok(doc.blocks.some(b=>b.text.includes('Hello world.')));
      assert.ok(doc.blocks.every(b=>!b.text.includes('Omit me')&&!b.text.includes('Share me')));
      for(const b of doc.blocks)assert.equal(resolveHTMLAnchor(dom.window.document,b.anchor).text,b.text);
      createDocument(doc,{kind:'html',identity:dom.window.document.URL});
    }}finally{dom.window.close();}
  }
  const dom=new JSDOM(`<div>${paragraph}<br><br>Second paragraph. ${paragraph}</div>`,{url:'https://example.org/'});
  try{const doc=await extractHTML(dom.window.document);assert.ok(doc.blocks.length>=2);assert.ok(doc.blocks.some(b=>b.text.startsWith('Second paragraph.')));}finally{dom.window.close();}
});
test('element-container selection boundaries preserve partial paragraphs and one body map serves a long page',async()=> {
  const dom=new JSDOM('<h1>Title</h1><p>First <b>bold</b> tail.</p><p>Second paragraph.</p>',{url:'https://example.org/'}),d=dom.window.document;
  try {
    const extraction=await extractHTML(d,{mode:'whole'}),p=d.querySelectorAll('p'),range=d.createRange();range.setStart(p[0],1);range.setEnd(p[1].firstChild,3);dom.window.getSelection().addRange(range);
    assert.deepEqual(selectedHTMLBlocks(d,extraction.blocks).spans,[{n:2,start:6,end:16},{n:3,start:0,end:3}]);
    const map=textMap(d.body);assert.deepEqual(map.position(range),{start:12,end:26});
    d.body.innerHTML=Array.from({length:1000},(_,i)=>`<p>Paragraph ${i}. ${paragraph}</p>`).join('');
    const book=await extractHTML(d,{mode:'whole'}),target=d.querySelectorAll('p')[500],selection=d.createRange();selection.setStart(target.firstChild,0);selection.setEnd(target.firstChild,12);dom.window.getSelection().removeAllRanges();dom.window.getSelection().addRange(selection);
    let maps=0;const segment=Intl.Segmenter.prototype.segment;Intl.Segmenter.prototype.segment=function(...args){maps++;return segment.apply(this,args);};
    try{const selected=selectedHTMLBlocks(d,book.blocks);assert.equal(selected.spans.length,1);assert.equal(selected.spans[0].n,501);assert.equal(maps,1);}finally{Intl.Segmenter.prototype.segment=segment;}
  }finally{dom.window.close();}
});
const item=(str,x,y,size,index)=>({str,x,y,size,index,width:str.length*size*.4,height:size});
test('PDF rows retain raised markers, join wrapped headings and drop empty/invalid glyph blocks before numbering',()=> {
  const prefix='The result was published in Nature',x=45+prefix.length*12*.4;
  const pages=[{index:0,width:600,height:800,label:'1',items:[item('A Very Long Study Title That Wraps',45,65,24,0),item('Onto A Second Line',45,94,24,1),item(prefix,45,200,12,2),item('1',x,196,8,3),item(' and widely discussed afterwards. '+paragraph, x+4,200,12,4),item('\u00ad',45,450,12,5),item('Hello \0 world \ud800',45,550,12,6)]}];
  const {blocks}=extractPDFBlocks(pages);
  assert.equal(blocks[0].text,'A Very Long Study Title That Wraps Onto A Second Line');
  assert.equal(blocks.filter(b=>b.kind==='heading').length,1);
  assert.ok(blocks[1].text.startsWith('The result was published in Nature1 and widely'));
  assert.ok(blocks.some(b=>b.text==='Hello world �'));assert.ok(blocks.every(b=>b.text && b.text.isWellFormed()));
  assert.deepEqual(blocks.map(b=>b.n),blocks.map((_,i)=>i+1));assert.equal(makeSections(blocks).length,1);
  for(const raw of ['Hello \0 world','\u00ad','Broken \ud800 glyph'])assert.equal(pdfTextOffsets(raw).text,normalizePDFText(raw));
  assert.equal(normalizeText('\0\u0001e\u0301\ud800'),'é�');
});
test('out-of-order bookmarks are reparented without rejecting the document',async()=> {
  for(const outline of [[{title:'Part',dest:[2,{name:'Fit'}],items:[{title:'Earlier child',dest:[1,{name:'Fit'}]}]}],[{title:'Part',dest:[0,{name:'Fit'}],items:[{title:'Later child',dest:[2,{name:'Fit'}]}]},{title:'Next part',dest:[1,{name:'Fit'}]}]]) {
    const blocks=Array.from({length:6},(_,i)=>({n:i+1,kind:'para',text:`Paragraph ${i}`,page:Math.floor(i/2),pageLabel:String(Math.floor(i/2)+1),top:40+i%2*40,bottom:60+i%2*40,anchor:{type:'pdf',page:Math.floor(i/2),items:[i%2],separators:[''],quote:{exact:`Paragraph ${i}`}}}));
    const {sections,warnings}=await outlineSections({getOutline:async()=>outline},blocks,[{},{},{}]);
    assert.ok(warnings.some(w=>w.cause==='outline-reparented'));assert.equal(sections[1].parent,null);
    createDocument({blocks,sections,version:await versionOf('pdf','text'),extractorVersion:'reader-2',pageCount:3,pageLabels:['1','2','3']},{kind:'pdf',identity:'pdf'});
  }
});
test('large PDF sources use compact base64 and byte comparison, including legacy import',async()=> {
  const doc=await exampleDocument(),store=await openDocumentStore({indexedDB:new IDBFactory()}),bytes=new Uint8Array(3*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  try {
    await store.saveDocument(doc,{bytes,mime:'application/pdf'});const archive=await store.exportData();
    assert.equal(archive.version,2);assert.equal(archive.stores.sources[0].bytes.encoding,'base64');assert.equal(archive.stores.sources[0].bytes.data.length,bytes.length/3*4);
    const before=Uint8Array.prototype.toJSON;Uint8Array.prototype.toJSON=()=>{throw Error('Byte arrays must never be stringified');};
    try{await store.importData(archive);assert.equal(equalData(bytes,bytes.slice()),true);}finally{if(before)Uint8Array.prototype.toJSON=before;else delete Uint8Array.prototype.toJSON;}
    const legacy=await store.exportData();legacy.version=1;legacy.stores.sources[0].bytes=Array.from(bytes.subarray(0,10));
    const other=await openDocumentStore({indexedDB:new IDBFactory()});try{await other.importData(legacy);assert.deepEqual((await other.getSource(doc.id,doc.version)).bytes,bytes.subarray(0,10));}finally{other.close();}
  }finally{store.close();}
});
test('foreign archives cannot import or regenerate Seatline maintenance commands',async()=> {
  const doc=await exampleDocument(),store=await openDocumentStore({indexedDB:new IDBFactory()});
  try {
    await store.saveDocument(doc);await store.put('chats',{id:'chat',docId:doc.id,target:{path:'seatline',provider:'claude'},session:{handle:'foreign'},cleanupGroup:'foreign-group'});
    const archive=await store.exportData();assert.equal(archive.stores.maintenance,undefined);assert.equal(archive.stores.chats[0].session,undefined);
    archive.stores.chats[0].sessionToken='crafted-handle';archive.stores.chats[0].cleanupGroup='crafted-group';
    archive.stores.maintenance=[{id:'injected',method:'forget',provider:'claude',handle:'arbitrary'}];
    const other=await openDocumentStore({indexedDB:new IDBFactory()});try{await other.importData(archive);await other.deleteDocument(doc.id);assert.deepEqual(await other.all('maintenance'),[]);}finally{other.close();}
  }finally{store.close();}
});
test('scope updates ignore late selections and rejections after a new scope or document',async()=> {
  const dom=new JSDOM('<div id="root">'+['scope-kind','scope-section','chapter-level'].map(id=>`<select id="${id}"></select>`).join('')+['scope-first','scope-last'].map(id=>`<input id="${id}">`).join('')+['scope-section-label','scope-pages','scope-size','scope-help','scope-refresh','chapter-level-label'].map(id=>`<div id="${id}"></div>`).join('')+'</div>');
  const previous=globalThis.document;globalThis.document=dom.window.document;
  try {
    let resolve,reject;const changes=[],picker=bindScopePicker(document.querySelector('#root'),{selection:()=>new Promise((yes,no)=>{resolve=yes;reject=no;}),onChange:scope=>changes.push(scope?.kind)});
    const doc=await exampleDocument();await picker.setDocument(doc);document.querySelector('#scope-kind').value='selection';const pending=picker.refresh();
    document.querySelector('#scope-kind').value='document';await picker.refresh();resolve({spans:[{n:3,start:0,end:4}]});await pending;
    assert.equal(picker.value.kind,'document');assert.equal(changes.at(-1),'document');
    document.querySelector('#scope-kind').value='selection';const failing=picker.refresh();await picker.setDocument(await exampleDocument('new'));reject(Error('late failure'));await failing;
    assert.equal(picker.value.docId,(await exampleDocument('new')).id);assert.equal(picker.value.kind,'document');
  }finally{globalThis.document=previous;dom.window.close();}
});
