import {scopeDescriptor,scopeKey} from './prompts.mjs';
import {idbRequest as request,transactionDone as complete,transaction} from '../documents/idb.mjs';
import {sessionHandles} from '../documents/runtime-bindings.mjs';

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
  async saveCompleted(doc,scope,prompt,target,entries,metadata={}) {
    return this.begin(doc,scope,prompt,target,{allowStale:true,completed:{entries,metadata}});
  }
  async begin(doc,scope,prompt,target,{previousId=null,allowStale=false,id=this.id(),completed=null}={}) {
    const tx=this.store.db.transaction(['docs','extractions','runs','records'],'readwrite'),done=complete(tx);
    const [current,extraction,rows,previous]=await Promise.all([
      request(tx.objectStore('docs').get(doc.id)),request(tx.objectStore('extractions').get([doc.id,doc.version])),
      request(tx.objectStore('runs').index('docId').getAll(doc.id)),previousId?request(tx.objectStore('runs').get(previousId)):Promise.resolve(null)
    ]);
    let error;
    if(!current || !extraction)error=Error('DOCUMENT_REMOVED');
    else if(current.version!==doc.version && !allowStale)error=Error('STALE_SCOPE');
    else if(previousId && (!previous || previous.status==='running' || previous.canContinue===false || !previous.metrics?.truncated || previous.continuedBy))error=Error('CONTINUATION_UNAVAILABLE');
    if(error) {tx.abort();await done.catch(()=>{});throw error;}
    const key=scopeKey(scope),version=1+rows.filter(r=>r.lens===prompt.config.lens && r.scopeKey===key).reduce((max,r)=>Math.max(max,r.version??0),0);
    const run={schemaVersion:1,id,docId:doc.id,extractionVersion:doc.version,lens:prompt.config.lens,scope:scopeDescriptor(scope),scopeKey:key,
      version,promptVersion:prompt.promptVersion,promptKey:prompt.promptKey,config:prompt.config,target:structuredClone(target),cleanupGroup:prompt.request.cleanupGroup,
      status:'running',createdAt:this.now(),updatedAt:this.now(),stale:current.version!==doc.version,previousId,metrics:{truncated:true},attempts:[]};
    if(completed)Object.assign(run,completed.metadata,{status:'completed',canContinue:false,completedAt:this.now(),metrics:{truncated:false,validRecords:completed.entries.length,newValidRecords:completed.entries.length,validRate:1}});
    tx.objectStore('runs').add(run);
    if(completed)for(const entry of completed.entries)tx.objectStore('records').add({...entry,runId:run.id});
    if(previous)tx.objectStore('runs').put({...previous,continuedBy:run.id});
    await done;return run;
  }
  async write(id,patch={},entries=[],{replace=false}={}) {
    if(!Object.keys(patch).length) {
      return transaction(this.store.db,['runs','records'],'readwrite',async tx=> {
        if(await request(tx.objectStore('runs').getKey(id))===undefined)throw Error('DOCUMENT_REMOVED');
        if(replace)await this.replaceRecords(tx,id,entries);
        else for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});
      });
    }
    const tx=this.store.db.transaction(['docs','runs','records'],'readwrite'),done=complete(tx);
    const run=await request(tx.objectStore('runs').get(id));
    const doc=run?await request(tx.objectStore('docs').get(run.docId)):null;
    if(!run || !doc) {tx.abort();await done.catch(()=>{});throw Error('DOCUMENT_REMOVED');}
    // Never resurrect a deleted run or clear a stale flag set by re-extraction in another page.
    tx.objectStore('runs').put({...run,...patch,...(patch.sessionHandles?{sessionHandles:[...new Set([...sessionHandles(run),...patch.sessionHandles])]}:{}),
      id:run.id,docId:run.docId,stale:run.stale || doc.version!==run.extractionVersion,updatedAt:this.now()});
    if(replace) {
      const cursor=tx.objectStore('records').index('runId').openCursor(id);
      cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}else for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});};
    } else for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});
    await done;
  }
  async replaceRecords(tx,id,entries) {
    await new Promise((resolve,reject)=> {
      const cursor=tx.objectStore('records').index('runId').openCursor(id);
      cursor.onerror=()=>reject(cursor.error??Error('REQUEST_FAILED'));
      cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}else resolve();};
    });
    for(const entry of entries)tx.objectStore('records').put({...entry,runId:id});
  }
  async interrupt(id,error={code:'INTERRUPTED',reason:'OWNER_CLOSED'}) {
    return transaction(this.store.db,['runs','records'],'readwrite',async tx=> {
      const run=await request(tx.objectStore('runs').get(id));
      if(!run || run.status!=='running')return false;
      const records=await request(tx.objectStore('records').index('runId').getAll(id));
      const metrics={...run.metrics,truncated:true,recovered:true,validRecords:records.length,
        retainedRecords:records.filter(e=>e.retained).length,newValidRecords:records.filter(e=>!e.retained).length};
      tx.objectStore('runs').put({...run,status:'interrupted',metrics,canContinue:error.code!=='TOO_LARGE',
        session:run.session?{...run.session,reusable:false}:null,error,updatedAt:this.now()});
      return true;
    });
  }
}
