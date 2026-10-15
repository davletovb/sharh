import {TIERS,usable,validateTarget} from '../ui/preferences.mjs';
import {targetKey} from '../paths/targets.mjs';
export {targetKey};
const transient=new Set(['RATE_LIMITED','NOT_INSTALLED','SIGNED_OUT','PROVIDER_UNAVAILABLE']);
export function validateFailover(policy){if(!policy||!['ask','automatic'].includes(policy.mode)||!Array.isArray(policy.targets)||policy.targets.length>12||policy.targets.some(t=>!t||typeof t.path!=='string'||typeof t.provider!=='string'||[t.model,t.effort,t.serviceTier].some(v=>v!=null&&(typeof v!=='string'||v.length>128)))||new Set(policy.targets.map(targetKey)).size!==policy.targets.length)throw Error('INVALID_FAILOVER_ORDER');return structuredClone(policy);}
const preferenceWrites=new WeakMap();
export class FailoverPreferences {
 constructor(storage){this.storage=storage;}
 async load(tier){if(!Object.hasOwn(TIERS,tier))throw Error('INVALID_TIER');const data=(await this.storage.get('sharhFailover')).sharhFailover??{};return validateFailover(data[tier]??{mode:'ask',targets:[{path:'seatline',provider:'claude'},{path:'seatline',provider:'codex'},{path:'seatline',provider:'gemini'},{path:'seatline',provider:'grok'}]});}
 async save(tier,value){if(!Object.hasOwn(TIERS,tier))throw Error('INVALID_TIER');const policy=validateFailover(value),write=async()=>{const data=(await this.storage.get('sharhFailover')).sharhFailover??{};await this.storage.set({sharhFailover:{...data,[tier]:policy}});return policy;},perform=()=>globalThis.navigator?.locks?navigator.locks.request('sharh:failover-preferences',write):write(),pending=(preferenceWrites.get(this.storage)??Promise.resolve()).catch(()=>{}).then(perform);preferenceWrites.set(this.storage,pending);return pending;}
}
export async function safeFailover(engine,error){if(!transient.has(error.code))return false;if(!error.runId)return true;const saved=await engine.repository.get(error.runId);return !!saved&&saved.run.status==='failed'&&saved.run.metrics?.outputBytes===0&&saved.records.length===0;}
export async function runWithFailover(engine,config,policy,options={}){
 policy=validateFailover(policy);const targets=[config.target,...policy.targets.filter(t=>targetKey(t)!==targetKey(config.target)&&!(t.path===config.target.path&&t.provider===config.target.provider&&!t.model&&!t.effort&&!t.serviceTier))],failures=[];
 let index=0;while(index<targets.length){const target=targets[index];
  if(options.signal?.aborted)throw Object.assign(Error('Stopped.'),{code:'CANCELLED'});
  try{const saved=await engine.start({...config,target,persistent:index===0?config.persistent:false,followRunId:index===0?config.followRunId:null},options);if(failures.length)await engine.repository.write(saved.run.id,{failover:{requestedTarget:config.target,failures}});return {...(failures.length?await engine.repository.get(saved.run.id):saved),failover:{failures,targets:targets.slice(0,index+1)}};}
  catch(error){if(!await safeFailover(engine,error))throw error;let nextIndex=index+1;for(;nextIndex<targets.length;nextIndex++){const candidate=targets[nextIndex];let info;try{info=(await engine.path(candidate).discover()).find(i=>i.provider===candidate.provider);validateTarget(candidate,info);}catch{continue;}if(usable(info)&&(config.operation!=='situate'||info.capabilities.webSearch))break;}
   if(nextIndex===targets.length)throw error;const next=targets[nextIndex],accepted=policy.mode==='automatic'&&config.priority==='background'||await options.approveFailover?.({error,from:target,to:next,signal:options.signal});if(options.signal?.aborted)throw Object.assign(Error('Stopped.'),{code:'CANCELLED'});if(!accepted)throw error;failures.push({target,error:{code:error.code,reason:error.reason},runId:error.runId??null});options.onFailover?.({from:target,to:next,failures});index=nextIndex;
  }
 }
}
