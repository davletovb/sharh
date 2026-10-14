import {SESSION_HANDLE,CLEANUP_GROUP} from '../paths/limits.mjs';
// A failed intention stays durable. One dispatcher per page; duplicate dispatch is idempotent.
export class MaintenanceDispatcher {
  constructor(store,paths) {this.store=store;this.paths=paths;this.active=null;}
  drain() {
    if(this.active)return this.active;
    this.active=this.flush().finally(()=>{this.active=null;});return this.active;
  }
  async flush() {
    const results=[];
    for(const row of await this.store.all('maintenance')) {
      const target={path:'seatline',provider:row.provider},path=this.paths.seatline;
      if(!path || !['claude','codex','gemini','grok'].includes(row.provider) ||
        !(row.method==='forget' && typeof row.handle==='string' && SESSION_HANDLE.test(row.handle) || row.method==='cleanup' && typeof row.group==='string' && CLEANUP_GROUP.test(row.group))) {
        results.push({id:row.id,status:'invalid'});continue;
      }
      try {
        if(row.method==='forget')await path.forget(target,[row.handle]);else await path.cleanup(target,row.group);
        const tx=this.store.db.transaction('maintenance','readwrite');
        const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};});
        tx.objectStore('maintenance').delete(row.id);await done;results.push({id:row.id,status:'completed'});
      } catch(error) {results.push({id:row.id,status:'pending',code:error.code??'PROVIDER_FAILED'});}
    }
    return results;
  }
}
