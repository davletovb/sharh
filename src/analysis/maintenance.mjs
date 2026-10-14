import contract from '../../config/seatline-contract.json' with {type:'json'};
import {SESSION_HANDLE,CLEANUP_GROUP} from '../paths/limits.mjs';
import {transaction,idbRequest} from '../documents/idb.mjs';
import {equalData} from '../documents/archive.mjs';

export class MaintenanceDispatcher {
  constructor(store,paths) {this.store=store;this.paths=paths;this.active=null;this.requested=false;}
  drain() {
    this.requested=true;
    if(!this.active)this.active=this.runPasses();
    return this.active;
  }
  async acknowledge(row) {
    return transaction(this.store.db,'maintenance','readwrite',async tx=> {
      const current=await idbRequest(tx.objectStore('maintenance').get(row.id));
      const same=current && (row.revision ? current.revision===row.revision : equalData(current,row));
      if(same)tx.objectStore('maintenance').delete(row.id);
      else if(current)this.requested=true;
      return same;
    });
  }
  async runPasses() {
    const results=[];
    try {
    do {
      this.requested=false;
      for(const row of await this.store.all('maintenance')) {
        const valid=contract.providers.includes(row.provider) && (row.method==='forget' && typeof row.handle==='string' && SESSION_HANDLE.test(row.handle) ||
          row.method==='cleanup' && typeof row.group==='string' && CLEANUP_GROUP.test(row.group));
        try {
          if(!valid) {await this.acknowledge(row);results.push({id:row.id,status:'discarded',code:'INVALID_INTENTION'});continue;}
          const path=this.paths.seatline;
          if(!path) {results.push({id:row.id,status:'pending',code:'PATH_UNAVAILABLE'});continue;}
          const target={path:'seatline',provider:row.provider};
          if(row.method==='forget')await path.forget(target,[row.handle]);else await path.cleanup(target,row.group);
          const removed=await this.acknowledge(row);results.push({id:row.id,status:removed?'completed':'superseded'});
        } catch(error) {results.push({id:row.id,status:'pending',code:error?.code??'PROVIDER_FAILED'});}
      }
    }while(this.requested);
      return results;
    }finally{this.active=null;}
  }
}
