import {scopeDescriptor,scopeKey} from './prompts.mjs';
const request = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const complete = tx => new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('TRANSACTION_ABORTED'));tx.onerror=()=>{};});

export class RunRepository {
  constructor(store,{now=Date.now,id=()=>crypto.randomUUID()}={}) {this.store=store;this.now=now;this.id=id;}
  async get(id) {
    const tx=this.store.db.transaction(['runs','records']),done=complete(tx);
    const [run,records]=await Promise.all([request(tx.objectStore('runs').get(id)),request(tx.objectStore('records').index('runId').getAll(id))]);
    await done;return run?{run,records:records.sort((a,b)=>a.sequence-b.sequence).map(({runId,...e})=>e)}:null;
  }
  async list(docId) {
    const tx=this.store.db.transaction('runs'),done=complete(tx),rows=await request(tx.objectStore('runs').index('docId').getAll(docId));
    await done;return rows.sort((a,b)=>b.createdAt-a.createdAt || b.version-a.version);
  }
  async begin(doc,scope,prompt,target,{previousId=null,allowStale=false}={}) {
    const tx=this.store.db.transaction(['docs','extractions','runs'],'readwrite'),done=complete(tx);
    const [current,extraction,rows,previous]=await Promise.all([
      request(tx.objectStore('docs').get(doc.id)),request(tx.objectStore('extractions').get([doc.id,doc.version])),
      request(tx.objectStore('runs').index('docId').getAll(doc.id)),previousId?request(tx.objectStore('runs').get(previousId)):Promise.resolve(null)
    ]);
    let error;
    if(!current || !extraction)error=Error('DOCUMENT_REMOVED');
    else if(current.version!==doc.version && !allowStale)error=Error('STALE_SCOPE');
    else if(previousId && (!previous || previous.status==='running' || !previous.metrics?.truncated || previous.continuedBy))error=Error('CONTINUATION_UNAVAILABLE');
    if(error) {tx.abort();await done.catch(()=>{});throw error;}
    const key=scopeKey(scope),version=1+rows.filter(r=>r.lens===prompt.config.lens && r.scopeKey===key).reduce((max,r)=>Math.max(max,r.version??0),0);
    const run={schemaVersion:1,id:this.id(),docId:doc.id,extractionVersion:doc.version,lens:prompt.config.lens,scope:scopeDescriptor(scope),scopeKey:key,
      version,promptVersion:prompt.promptVersion,promptKey:prompt.promptKey,config:prompt.config,target:structuredClone(target),cleanupGroup:prompt.request.cleanupGroup,
      status:'running',createdAt:this.now(),updatedAt:this.now(),stale:current.version!==doc.version,previousId,metrics:{truncated:true},attempts:[]};
    tx.objectStore('runs').add(run);
    if(previous)tx.objectStore('runs').put({...previous,continuedBy:run.id});
    await done;return run;
  }
  async write(id,patch={},entries=[],{replace=false}={}) {
    const tx=this.store.db.transaction(['docs','runs','records'],'readwrite'),done=complete(tx);
    const run=await request(tx.objectStore('runs').get(id));
    const doc=run?await request(tx.objectStore('docs').get(run.docId)):null;
    if(!run || !doc) {tx.abort();await done.catch(()=>{});throw Error('DOCUMENT_REMOVED');}
    // Never resurrect a deleted run or clear a stale flag set by re-extraction in another page.
    tx.objectStore('runs').put({...run,...patch,id:run.id,docId:run.docId,stale:run.stale || doc.version!==run.extractionVersion,updatedAt:this.now()});
    if(replace) {
      const cursor=tx.objectStore('records').index('runId').openCursor(id);
      cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}else for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});};
    } else for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});
    await done;
  }
}
