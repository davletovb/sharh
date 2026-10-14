const localOwners=new Set();
// Browser locks are released when their page/worker dies. No timeout can steal a live turn.
export class RunOwnership {
  constructor(namespace,{locks=globalThis.navigator?.locks}={}) {this.prefix=`sharh:${namespace}:run:`;this.locks=locks;}
  hold(id,action,{ifAvailable=false}={}) {
    const name=this.prefix+id;
    if(this.locks)return this.locks.request(name,{mode:'exclusive',...(ifAvailable?{ifAvailable:true}:{})},lock=>lock?action():null);
    if(localOwners.has(name))return ifAvailable?Promise.resolve(null):Promise.reject(Error('RUN_BUSY'));
    localOwners.add(name);
    return Promise.resolve().then(action).finally(()=>localOwners.delete(name));
  }
}
