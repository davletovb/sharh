import {RecordParser} from './parser.mjs';
import {RunRepository} from './storage.mjs';
import {assemblePrompt,repairRequest,continuationTask,PROMPT_VERSION} from './prompts.mjs';
import {SESSION_HANDLE} from '../paths/limits.mjs';
import {cancelled,PathError} from '../paths/errors.mjs';

const notify=(observer,event)=>{try{observer?.(event);}catch{/* UI observers are isolated. */}};
export class AnalysisEngine {
  constructor({store,paths,now=()=>performance.now(),repository=new RunRepository(store)}) {
    Object.assign(this,{store,paths,now,repository});this.active=new Map();
  }
  path(target) {const path=this.paths[target?.path];if(!path)throw Error('PATH_UNAVAILABLE');return path;}
  async start({doc,scope,target,persistent=false,...config},{signal,onEvent}={}) {
    if(signal?.aborted)throw cancelled();
    doc=structuredClone(doc);scope=structuredClone(scope);target=structuredClone(target);
    const path=this.path(target);
    if(persistent) {
      const info=(await path.discover()).find(p=>p.provider===target.provider);
      persistent=info?.capabilities.sessions===true;
    }
    const prompt=assemblePrompt(doc,scope,{...config,session:{mode:persistent?'start':'none'}});
    const run=await this.repository.begin(doc,scope,prompt,target);
    return this.execute({run,doc,scope,prompt,path,signal,onEvent});
  }
  async continue(id,{mode='auto',signal,onEvent}={}) {
    if(!['auto','new'].includes(mode))throw Error('INVALID_CONTINUATION');
    if(signal?.aborted)throw cancelled();
    const saved=await this.repository.get(id);
    if(!saved || saved.run.status==='running' || !saved.run.metrics?.truncated || saved.run.continuedBy || this.active.has(id))throw Error('CONTINUATION_UNAVAILABLE');
    const previous=saved.run;
    if(previous.promptVersion!==PROMPT_VERSION)throw Error('PROMPT_VERSION_CHANGED');
    const doc=await this.store.getDocument(previous.docId,previous.extractionVersion);
    if(!doc)throw Error('DOCUMENT_REMOVED');
    const byNumber=new Map(doc.blocks.map(b=>[b.n,b]));
    const scope={...previous.scope,blocks:previous.scope.blocks.map(({n,...marks})=>({...byNumber.get(n),...marks}))};
    const path=this.path(previous.target);
    let session={mode:'none'};
    if(mode==='auto' && previous.session?.handle && SESSION_HANDLE.test(previous.session.handle)) {
      const info=(await path.discover()).find(p=>p.provider===previous.target.provider);
      if(info?.capabilities.sessions)session={mode:'continue',handle:previous.session.handle};
    }
    const prompt=assemblePrompt(doc,scope,{...previous.config,session});
    if(prompt.promptKey!==previous.promptKey)throw Error('CONTINUATION_CONFIG_CHANGED');
    prompt.request.task=continuationTask(prompt.request.task,saved.records);
    const run=await this.repository.begin(doc,scope,prompt,previous.target,{previousId:id,allowStale:true});
    return this.execute({run,doc,scope,prompt,path,retained:saved.records,signal,onEvent});
  }
  cancel(id) {this.active.get(id)?.abort();}
  async execute({run,doc,scope,prompt,path,retained=[],signal,onEvent}) {
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    this.active.set(run.id,controller);
    const started=this.now();let firstRecordMs=null;
    let writes=Promise.resolve(),writeError=null,session=null,sessionLost=false;
    const enqueue=(...args)=> {
      writes=writes.then(()=>this.repository.write(run.id,...args)).catch(error=>{writeError??=error;controller.abort();});
    };
    const attempts=[];
    const attempt=async(request,index)=> {
      let raw='',streamed='',result=null;
      let contextLost=false;
      const createParser=()=>new RecordParser({lens:run.lens,blocks:scope.blocks,sections:doc.sections,now:this.now,onRecord:entry=>{
        if(!entry.retained)firstRecordMs??=this.now()-started;
        if(index===0) {enqueue({},[entry]);notify(onEvent,{type:'record',runId:run.id,attempt:index,entry});}
      }});
      let parser=createParser();
      if(retained.length)parser.seed(retained);
      let error=null;
      try {
        result=await path.run(run.target,request,{signal:combined,onEvent:event=> {
          if(event.type==='delta') {raw+=event.text;streamed+=event.text;if(!contextLost)parser.push(event.text);}
          if(event.type==='session' && request.session.mode!=='none' && typeof event.handle==='string' && SESSION_HANDLE.test(event.handle)) {
            session={handle:event.handle};sessionLost=false;enqueue({session});
          }
          if(event.type==='session_lost') {session=null;sessionLost=true;contextLost=request.session.mode==='continue';enqueue({session:null});}
          notify(onEvent,{...event,runId:run.id,attempt:index});
        }});
        // Non-streaming paths may return all text only in their terminal result.
        if(!streamed && result.text) {raw=result.text;if(!contextLost)parser.push(result.text);}
        else if(result.text!==undefined && result.text!==streamed)throw Error('PATH_TEXT_MISMATCH');
        if(contextLost)throw new PathError('PROVIDER_FAILED','UNKNOWN_SESSION',false,{hint:'The session was lost. Continue as a new run to resend the scope.'});
        if(request.session.mode!=='none' && typeof result.session==='string' && SESSION_HANDLE.test(result.session))session={handle:result.session};
      } catch(e) {error=e;}
      if(contextLost) {notify(onEvent,{type:'reset',runId:run.id});enqueue({},[],{replace:true});parser=createParser();parser.seed(retained);}
      const parsed=parser.finish({truncated:!!error || result?.truncated===true,usage:result?.usage??null});
      const summary={kind:request.kind,metrics:parsed.metrics,accepted:!error && parsed.metrics.validRate>=0.8 && parsed.metrics.newValidRecords>0,
        ...(error?{error:{code:error.code??'PROVIDER_FAILED',reason:error.reason??error.message}}:{})};
      attempts.push(summary);
      await writes;if(writeError)throw writeError;
      return {...parsed,raw,result,error};
    };
    notify(onEvent,{type:'run',runId:run.id,status:'running',version:run.version});
    let final;
    try {
      final=await attempt(prompt.request,0);
      // Only restart a lost session when no new model output arrived; never replay a partially delivered turn.
      if(final.error?.reason==='UNKNOWN_SESSION' && !final.raw && prompt.request.session.mode==='continue') {
        session=null;sessionLost=true;notify(onEvent,{type:'session_reset',runId:run.id,hint:'The session was lost. The scope is being sent again.'});
        prompt.request={...prompt.request,session:{mode:'start'},document:assemblePrompt(doc,scope,run.config).request.document};
        notify(onEvent,{type:'reset',runId:run.id});enqueue({},[],{replace:true});
        final=await attempt(prompt.request,0);
      }
      if(!final.error && (final.metrics.validRate<0.8 || final.metrics.newValidRecords===0) && !combined.aborted) {
        const capped=final.result?.truncated===true;
        notify(onEvent,{type:'repairing',runId:run.id});
        // Raw output is quoted as JSON data; a repair turn never receives the source document.
        const repaired=await attempt(repairRequest(run.lens,run.config.language,final.raw,run.cleanupGroup),1);
        if(!repaired.error && repaired.metrics.validRate>=0.8 && repaired.metrics.newValidRecords>0) {
          // Repair may fix a missing end marker, but cannot recover content cut off by a path cap.
          final={...repaired,metrics:{...repaired.metrics,truncated:repaired.metrics.truncated || capped}};
          session=null;notify(onEvent,{type:'reset',runId:run.id});
          for(const entry of final.records)notify(onEvent,{type:'record',runId:run.id,attempt:1,entry});
        } else notify(onEvent,{type:'repair_failed',runId:run.id,code:repaired.error?.code??'INVALID_OUTPUT'});
      }
      if(combined.aborted && !final.error) {final.error=cancelled();final.metrics.truncated=true;}
      const status=final.error?(final.error.code==='CANCELLED'?'cancelled':'failed'):final.metrics.truncated?'truncated':final.metrics.validRate<0.8 || !final.metrics.validRecords?'invalid':'completed';
      final.metrics=structuredClone(final.metrics);
      final.metrics.timeToFirstRecordMs=firstRecordMs;final.metrics.totalMs=this.now()-started;
      const usages=attempts.map(a=>a.metrics.usage).filter(Boolean);
      final.metrics.usage=usages.length?Object.fromEntries([...new Set(usages.flatMap(u=>Object.keys(u)))].map(k=>[k,usages.reduce((n,u)=>n+(Number.isFinite(u[k])?u[k]:0),0)])):null;
      const patch={status,metrics:final.metrics,attempts,target:final.result?.target??run.target,session:sessionLost?null:session,canContinue:final.metrics.truncated,
        completedAt:Date.now(),...(final.error?{error:{code:final.error.code??'PROVIDER_FAILED',reason:final.error.reason??final.error.message}}:{})};
      await writes;if(writeError)throw writeError;
      await this.repository.write(run.id,patch,final.records,{replace:true});
      notify(onEvent,{type:'run',runId:run.id,status,canContinue:patch.canContinue});
      const saved=await this.repository.get(run.id);
      if(final.error)throw Object.assign(final.error,{runId:run.id});
      return saved;
    } catch(error) {
      // A deletion is authoritative: no catch/finally path recreates its run or records.
      notify(onEvent,{type:'run',runId:run.id,status:error.message==='DOCUMENT_REMOVED'?'deleted':'failed'});
      throw error;
    } finally {this.active.delete(run.id);}
  }
}
