import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore,validateArchive,STORE_KEYS} from '../src/documents/store.mjs';
import {versionOf} from '../src/documents/model.mjs';
import {exampleDocument} from './helpers/document.mjs';
const open=()=>openDocumentStore({indexedDB:new IDBFactory()});
test('IndexedDB stores extraction versions, anchors and source bytes across close/reopen',async()=> {
  const indexedDB=new IDBFactory(), db=await openDocumentStore({indexedDB}), doc=await exampleDocument();
  await db.saveDocument(doc,{bytes:new Uint8Array([1,2,255]),mime:'application/pdf'});
  await db.put('runs',{id:'r1',docId:doc.id,extractionVersion:doc.version});
  const changed=structuredClone(doc); changed.title='Updated title'; changed.version=await versionOf(doc.identity,'changed');
  changed.blocks[2].text='Changed paragraph'; changed.blocks[2].anchor.quote.exact='Changed paragraph';
  await db.saveDocument(changed);
  assert.equal((await db.all('runs'))[0].stale,true);
  assert.deepEqual(await db.getDocument(doc.id,doc.version),doc);
  assert.deepEqual(await db.getDocument(doc.id),changed);
  db.close();
  const again=await openDocumentStore({indexedDB});
  assert.deepEqual((await again.getSource(doc.id,doc.version)).bytes,new Uint8Array([1,2,255]));
  assert.deepEqual(await again.getDocument(doc.id),changed); again.close();
});
test('export/import round trips all stores, including historical extractions and binary sources',async()=> {
  const db=await open(), doc=await exampleDocument();
  await db.saveDocument(doc,{bytes:new Uint8Array([37,80,68,70,0,255]),mime:'application/pdf'});
  await db.put('runs',{id:'r1',docId:doc.id,extractionVersion:doc.version,metrics:{valid:4}});
  await db.put('records',{runId:'r1',sequence:0,record:{t:'note',text:'A record'}});
  await db.put('chats',{id:'c1',docId:doc.id,messages:[{role:'user',text:'Question'}]});
  await db.put('jobs',{id:'j1',docId:doc.id,steps:[]});
  await db.put('glossary',{bookId:doc.id,term:'Oʻzbek',translation:'Uzbek'});
  await db.put('collections',{id:'l1',items:[{docId:doc.id,first:2,last:7}]});
  const archive=JSON.parse(JSON.stringify(await db.exportData())), target=await open();
  assert.equal(await target.importData(archive),1);
  assert.deepEqual(await target.exportData(),archive);
  assert.deepEqual(await target.getDocument(doc.id),doc);
  assert.equal(await target.importData(archive),1); // Identical import is idempotent.
  db.close(); target.close();
});
test('document deletion cascades through versions, records, chats, jobs, glossary and collection memberships; preserves other docs',async()=> {
  const db=await open(), a=await exampleDocument(), b=await exampleDocument('https://example.org/other');
  await db.saveDocument(a,{html:'<p>Source</p>'}); await db.saveDocument(b);
  await db.put('runs',{id:'r1',docId:a.id,target:{path:'seatline',provider:'claude'},session:{handle:'h1'},cleanupGroup:'g1'});
  await db.put('runs',{id:'r2',docId:b.id});
  await db.put('records',{runId:'r1',sequence:0}); await db.put('records',{runId:'r2',sequence:0});
  await db.put('chats',{id:'c1',docId:a.id,path:'seatline',provider:'codex',sessionToken:'h2',cleanupGroup:'g2'});
  await db.put('jobs',{id:'j1',docId:a.id,target:{path:'seatline',provider:'claude'},cleanupGroup:'g1'});
  await db.put('glossary',{bookId:a.id,term:'term'});
  await db.put('collections',{id:'l1',items:[a.id,{docId:a.id},b.id]});
  const intents=await db.deleteDocument(a.id);
  assert.equal(intents.handles.length,2); assert.equal(intents.groups.length,2);
  assert.equal(await db.getDocument(a.id),null); assert.equal((await db.getDocument(b.id)).id,b.id);
  for(const name of ['extractions','blocks','sections','sources','runs','chats','jobs']) assert.ok((await db.all(name)).every(row=>row.docId!==a.id),name);
  assert.deepEqual(await db.all('records'),[{runId:'r2',sequence:0}]);
  assert.deepEqual((await db.all('collections'))[0].items,[b.id]); assert.deepEqual(await db.all('glossary'),[]);
  assert.equal((await db.all('maintenance')).length,4);
  await db.deleteDocument(a.id); assert.equal((await db.all('maintenance')).length,4); db.close();
});
test('invalid archives and conflicting imports leave local data untouched, including independent new rows',async()=> {
  const db=await open(), doc=await exampleDocument(), other=await exampleDocument('https://example.org/new');
  await db.saveDocument(doc); const original=await db.exportData();
  for (const mutate of [a=>a.version=99,a=>a.stores.records.push({runId:'missing',sequence:1}),a=>a.stores.blocks[0].n=99,a=>a.stores.sections[0].parent='missing',a=>a.stores.docs.push(a.stores.docs[0]),a=>a.stores.sources.push({docId:doc.id,version:doc.version,bytes:[256]})]) {
    const archive=structuredClone(original); mutate(archive); assert.throws(()=>validateArchive(archive));
  }
  const incoming=await open(); await incoming.saveDocument({...doc,title:'Different title'}); await incoming.saveDocument(other);
  await assert.rejects(db.importData(await incoming.exportData()),/IMPORT_CONFLICT/);
  assert.deepEqual(await db.exportData(),original);
  assert.equal(Object.keys(STORE_KEYS).length,12); db.close(); incoming.close();
});
