import {validateDocument} from './model.mjs';
import {equalData,portableRow,encodeBytes,decodeBytes} from './archive.mjs';
import {idbRequest as result,transactionDone as done,transaction} from './idb.mjs';
import {queueBindings,queueMaintenance,sessionHandles} from './runtime-bindings.mjs';
import {SESSION_HANDLE} from '../paths/limits.mjs';
import {assertCanonicalRecords} from '../analysis/contract.mjs';
import {QuotationIndex} from '../analysis/quotes.mjs';
export const STORE_KEYS = Object.freeze({
  docs: 'id', extractions: ['docId','version'], blocks: ['docId','version','n'], sections: ['docId','version','id'],
  sources: ['docId','version'], runs: 'id', records: ['runId','sequence'], chats: 'id',
  collections: 'id', glossary: ['bookId','term'], jobs: 'id', maintenance: 'id'
});
const stores = Object.keys(STORE_KEYS);
const archiveStores=stores.filter(name=>name!=='maintenance');
const metadata = ({blocks, sections, ...doc}) => doc;
const strip = ({docId, ...row}) => row;
export async function openDocumentStore({indexedDB = globalThis.indexedDB, name = 'sharh'} = {}) {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const [name, keyPath] of Object.entries(STORE_KEYS)) {
      const s = db.createObjectStore(name, {keyPath});
      if (['extractions','blocks','sections','sources','runs','chats','jobs'].includes(name)) s.createIndex('docId', 'docId');
      if (name === 'records') s.createIndex('runId', 'runId');
      if (name === 'glossary') s.createIndex('bookId', 'bookId');
    }
  };
  const db = await result(request);
  db.onversionchange = () => db.close();
  return new DocumentStore(db);
}
export class DocumentStore {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }
  async getDocument(id, version) {
    const tx = this.db.transaction(['docs','extractions','blocks','sections'], 'readonly'), complete = done(tx);
    const meta = await result(version ? tx.objectStore('extractions').get([id, version]) : tx.objectStore('docs').get(id));
    if (!meta) { await complete; return null; }
    // Issue all dependent reads in the request microtask while the transaction is active.
    const [blocks, sections] = await Promise.all(['blocks','sections'].map(name => result(tx.objectStore(name).index('docId').getAll(id))));
    await complete;
    return {...strip(meta), id, blocks: blocks.filter(b => b.version === meta.version).map(({docId, version, ...b}) => b),
      sections: sections.filter(s => s.version === meta.version).map(({docId, version, ...s}) => s)};
  }
  async listDocuments() { return this.all('docs'); }
  async all(name) { const tx = this.db.transaction(name), complete = done(tx); const rows = await result(tx.objectStore(name).getAll()); await complete; return rows; }
  async put(name, row) {
    if (!stores.includes(name) || ['docs','extractions','blocks','sections','sources'].includes(name)) throw Error('USE_SAVE_DOCUMENT');
    const tx = this.db.transaction(name, 'readwrite'), complete = done(tx);
    if(name==='maintenance')queueMaintenance(tx,row);else tx.objectStore(name).put(row);await complete;
  }
  async writeOwned(name,row) {
    if(!['chats','jobs'].includes(name))throw Error('INVALID_OWNED_STORE');
    return transaction(this.db,['docs',name],'readwrite',async tx=>{if(!await result(tx.objectStore('docs').getKey(row.docId)))throw Error('DOCUMENT_REMOVED');tx.objectStore(name).put(row);});
  }
  async rememberSession(context,handle) {
    if(typeof handle!=='string' || !SESSION_HANDLE.test(handle))throw Error('INVALID_SESSION');
    return transaction(this.db,['runs','maintenance'],'readwrite',async tx=> {
      const run=await result(tx.objectStore('runs').get(context.id));
      if(run) {
        if(run.target?.path!==context.target.path || run.target?.provider!==context.target.provider)throw Error('SESSION_TARGET_CHANGED');
        const handles=sessionHandles(run);
        if(!handles.includes(handle))tx.objectStore('runs').put({...run,sessionHandles:[...handles,handle]});
      } else queueBindings(tx,{target:context.target,sessionHandles:[handle],cleanupGroup:context.cleanupGroup});
      return !!run;
    });
  }
  async saveDocument(doc, source, {makeCurrent=true}={}) {
    validateDocument(doc);
    const tx = this.db.transaction(['docs','extractions','blocks','sections','sources','runs','collections'], 'readwrite'), complete = done(tx);
    const meta = {...metadata(doc),updatedAt:Date.now()};
    const current=await result(tx.objectStore('docs').get(doc.id)),promote=makeCurrent || !current;
    if(doc.derived){const missing=await Promise.all(doc.derived.sources.map(s=>result(tx.objectStore('extractions').getKey([s.docId,s.version]))));if(missing.some(v=>v===undefined)||doc.derived.collectionId&&!await result(tx.objectStore('collections').getKey(doc.derived.collectionId))){tx.abort();await complete.catch(()=>{});throw Error('SOURCE_REMOVED');}}
    if(promote)tx.objectStore('docs').put(meta);
    tx.objectStore('extractions').put({...meta, docId: doc.id});
    for (const b of doc.blocks) tx.objectStore('blocks').put({...b, docId: doc.id, version: doc.version});
    for (const s of doc.sections) tx.objectStore('sections').put({...s, docId: doc.id, version: doc.version});
    if (source) tx.objectStore('sources').put({...source, docId: doc.id, version: doc.version});
    if(promote){const cursor = tx.objectStore('runs').index('docId').openCursor(doc.id);
    cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (c.value.extractionVersion !== doc.version) c.update({...c.value, stale: true}); c.continue(); };}
    await complete;
    return doc.id;
  }
  async getSource(id, version) { const tx = this.db.transaction('sources'), complete = done(tx); const value = await result(tx.objectStore('sources').get([id, version])); await complete; return value; }
  async deleteDocument(id) {const refs={};await transaction(this.db,stores,'readwrite',async tx=>Object.assign(refs,await this.deleteGraph(tx,{docIds:[id]})));return {handles:[...refs.handles].map(JSON.parse),groups:[...refs.groups].map(JSON.parse)};}
  async deleteCollection(id) {return transaction(this.db,stores,'readwrite',tx=>this.deleteGraph(tx,{collectionIds:[id]}));}
  async deleteGraph(tx,{docIds=[],collectionIds=[]}) {
    const docs=await result(tx.objectStore('docs').getAll()),removed=new Set(docIds),collections=new Set(collectionIds),handles=new Set(),groups=new Set();
    let changed=true;while(changed){changed=false;for(const doc of docs)if(!removed.has(doc.id)&&doc.derived&&(collections.has(doc.derived.collectionId)||doc.derived.sources?.some(s=>removed.has(s.docId)))){removed.add(doc.id);changed=true;}}
    for(const id of removed){tx.objectStore('docs').delete(id);for(const name of ['extractions','blocks','sections','sources','runs','chats','jobs','glossary']){const cursor=tx.objectStore(name).index(name==='glossary'?'bookId':'docId').openCursor(id);cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(['runs','chats','jobs'].includes(name)){const queued=queueBindings(tx,c.value);for(const h of queued.handles)handles.add(JSON.stringify(h));for(const g of queued.groups)groups.add(JSON.stringify(g));}if(name==='runs'){const records=tx.objectStore('records').index('runId').openCursor(c.value.id);records.onsuccess=()=>{const r=records.result;if(r){r.delete();r.continue();}};}c.delete();c.continue();};}}
    const cursor=tx.objectStore('collections').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(collections.has(c.value.id))c.delete();else c.update({...c.value,items:(c.value.items??[]).filter(i=>!removed.has(typeof i==='string'?i:i.docId))});c.continue();};
    return {handles,groups};
  }
  async exportData() {
    const tx = this.db.transaction(archiveStores), complete = done(tx), data = {};
    await Promise.all(archiveStores.map(async name => { data[name] = await result(tx.objectStore(name).getAll()); }));
    await complete;
    for(const name of ['runs','chats','jobs'])data[name]=data[name].map(portableRow);
    data.sources = data.sources.map(row => ({...row, ...(row.bytes ? {bytes:encodeBytes(row.bytes)} : {})}));
    return {format: 'sharh-documents', version: 2, stores: data};
  }
  async importData(archive) {
    const data = validateArchive(archive);
    const tx = this.db.transaction(stores, 'readwrite'), complete = done(tx); let conflict;
    // Existing rows may be identical; differing rows abort the entire import, preserving local data.
    for (const name of archiveStores) for (const row of data[name]) {
      const key = Array.isArray(STORE_KEYS[name]) ? STORE_KEYS[name].map(k => row[k]) : row[STORE_KEYS[name]];
      const request = tx.objectStore(name).get(key);
      request.onsuccess = () => {
        const existing=['runs','chats','jobs'].includes(name) && request.result ? portableRow(request.result) : request.result;
        if (existing && !equalData(existing, row)) { conflict = Error('IMPORT_CONFLICT: Export or delete the existing document before importing a different version.'); tx.abort(); return; }
        if (!request.result) tx.objectStore(name).put(row);
      };
    }
    try { await complete; } catch (e) { throw conflict || e; }
    return data.docs.length;
  }
}
export function validateArchive(archive) {
  if (archive?.format !== 'sharh-documents' || ![1,2].includes(archive.version) || !archive.stores ||
      Object.keys(archive.stores).some(name => !stores.includes(name)) || archiveStores.some(name => !Array.isArray(archive.stores[name]))) throw Error('INVALID_ARCHIVE');
  const data = structuredClone(archive.stores), docs = new Map(data.docs.map(doc => [doc.id, doc])), versions = new Map();
  data.maintenance=[];
  for(const name of ['runs','chats','jobs'])data[name]=data[name].map(portableRow);
  for (const name of stores) {
    const keys = new Set();
    for (const row of data[name]) {
      const fields = Array.isArray(STORE_KEYS[name]) ? STORE_KEYS[name] : [STORE_KEYS[name]], key = fields.map(k => row?.[k]);
      if (key.some((value,i) => ['n','sequence'].includes(fields[i]) ? !Number.isSafeInteger(value) || value < (fields[i]==='n'?1:0) : typeof value!=='string' || !value) || keys.has(JSON.stringify(key))) throw Error('INVALID_ARCHIVE_KEY');
      keys.add(JSON.stringify(key));
    }
  }
  for (const extraction of data.extractions) {
    if (!docs.has(extraction.docId) || extraction.id !== extraction.docId) throw Error('ORPHAN_EXTRACTION');
    const doc = {...strip(extraction), blocks: data.blocks.filter(b => b.docId === extraction.docId && b.version === extraction.version).map(({docId,version,...b}) => b),
      sections: data.sections.filter(s => s.docId === extraction.docId && s.version === extraction.version).map(({docId,version,...s}) => s)};
    validateDocument(doc); versions.set(`${doc.id}:${doc.version}`, doc);
  }
  for (const doc of docs.values()) {
    const extraction=versions.get(`${doc.id}:${doc.version}`);
    if (!extraction) throw Error('MISSING_EXTRACTION');
    validateDocument({...doc,blocks:extraction.blocks,sections:extraction.sections});
  }
  for (const name of ['blocks','sections','sources']) for (const row of data[name]) if (!versions.has(`${row.docId}:${row.version}`)) throw Error('ORPHAN_EXTRACTION_DATA');
  for (const name of ['runs','chats','jobs']) for (const row of data[name]) if (!docs.has(row.docId)) throw Error('ORPHAN_DOCUMENT_DATA');
  const runs = new Set(data.runs.map(r => r.id));
  for (const row of data.records) if (!runs.has(row.runId)) throw Error('ORPHAN_RECORD');
  for(const run of data.runs)if(run.schemaVersion===1) {
    const extraction=versions.get(`${run.docId}:${run.extractionVersion}`);
    if(!extraction || !Array.isArray(run.scope?.blocks))throw Error('INVALID_RUN');
    const records=data.records.filter(r=>r.runId===run.id),scope=new Set(run.scope.blocks.map(b=>b.n));
    assertCanonicalRecords(records,run.lens,{scope,sections:extraction.sections,blocks:extraction.blocks,customLens:run.config?.customLens});
    const sourceURLs=new Set((run.sources??[]).map(s=>s.url));if(records.some(e=>e.flags?.includes('source_verified') && !sourceURLs.has(e.record.url)))throw Error('UNVERIFIED_SOURCE_LINK');
    const quotes=new QuotationIndex(extraction.blocks.filter(b=>scope.has(b.n)));
    if(records.some(({record:r})=>r.quote && !quotes.verify(r.quote,r.refs??(r.ref?[r.ref]:[]))))throw Error('INVALID_ARCHIVE_QUOTATION');
  }
  for(const doc of versions.values())if(doc.derived){if(!['literature-review','meta-synthesis','compare'].includes(doc.derived.kind)||!Array.isArray(doc.derived.sources)||doc.derived.sources.length<2)throw Error('INVALID_DERIVED_DOCUMENT');for(const block of doc.blocks){const ref=block.source,source=doc.derived.sources.find(s=>s.itemId===ref?.itemId&&s.docId===ref.docId&&s.version===ref.version),original=source&&versions.get(`${source.docId}:${source.version}`);if(!original?.blocks.some(b=>b.n===ref.n)||!source.scope?.blocks.some(b=>b.n===ref.n))throw Error('INVALID_SOURCE_REFERENCE');}}
  for(const collection of data.collections)for(const item of collection.items??[])if(typeof item!=='string'&&item.scope){const original=versions.get(`${item.docId}:${item.version}`);if(!original||original.derived||!Array.isArray(item.scope.blocks)||!item.scope.blocks.length||item.scope.docId!==item.docId||item.scope.version!==item.version||item.scope.blocks.some(b=>!original.blocks.some(x=>x.n===b.n)))throw Error('INVALID_LIBRARY_ITEM');}
  for(const job of data.jobs)if(job.kind==='book'){const doc=versions.get(`${job.docId}:${job.extractionVersion}`);if(!doc||!Array.isArray(job.chapters)||!job.chapters.length||!job.config||!job.policy||!['ask','automatic'].includes(job.policy.mode)||!Array.isArray(job.policy.targets)||!job.scope?.blocks?.length)throw Error('INVALID_BOOK_JOB');for(const chapter of job.chapters){if(!Array.isArray(chapter.span)||chapter.span.length!==2||chapter.span.some(n=>!Number.isSafeInteger(n)||n<1||n>doc.blocks.length)||chapter.span[0]>chapter.span[1]||!chapter.scope?.blocks?.length||chapter.scope.docId!==doc.id||chapter.scope.version!==doc.version||chapter.scope.blocks.some(b=>b.n<chapter.span[0]||b.n>chapter.span[1]))throw Error('INVALID_BOOK_JOB');if(chapter.runId){const run=data.runs.find(r=>r.id===chapter.runId);if(!run||run.docId!==doc.id||run.extractionVersion!==doc.version||run.lens!=='digest')throw Error('INVALID_DIGEST_RUN');}}}
  for (const row of data.glossary) if (!docs.has(row.bookId)) throw Error('ORPHAN_GLOSSARY');
  for (const collection of data.collections) if (!Array.isArray(collection.items) || collection.items.some(item => !docs.has(typeof item === 'string' ? item : item?.docId))) throw Error('ORPHAN_COLLECTION_ITEM');
  for (const row of data.sources) if (row.bytes !== undefined) {
    row.bytes=decodeBytes(row.bytes,archive.version);
  }
  return data;
}
