import {RecordParser} from './parser.mjs';
import {RunRepository} from './storage.mjs';
import {RunOwnership} from './ownership.mjs';
import {assemblePrompt,repairRequest,continuationTask,PROMPT_VERSION} from './prompts.mjs';
import {preflightRequest,requestPreview} from './requests.mjs';
import {SESSION_HANDLE} from '../paths/limits.mjs';
import {cancelled,PathError} from '../paths/errors.mjs';
import {scopeKey} from './prompts.mjs';
import {safeURL} from './contract.mjs';

const notify=(observer,event)=>{try{observer?.(event);}catch{/* UI observers are isolated. */}};
const acceptable = metrics => metrics.validRate>=0.8 && (metrics.newValidRecords>0 || metrics.emptyCompletion);
export class AnalysisEngine {
  constructor({store,paths,now=()=>performance.now(),repository=new RunRepository(store),ownership=new RunOwnership(store.db.name),onMaintenanceNeeded=()=>{}}) {
    Object.assign(this,{store,paths,now,repository,ownership,onMaintenanceNeeded});this.active=new Map();
    this.ready=this.recover();this.ready.catch(()=>{});
  }
  path(target) {const path=this.paths[target?.path];if(!path)throw Error('PATH_UNAVAILABLE');return path;}
  async recover(docId) {
    for(const run of await this.store.all('runs'))if(run.status==='running' && (!docId || run.docId===docId)) {
      await this.ownership.hold(run.id,()=>this.repository.interrupt(run.id),{ifAvailable:true});
    }
  }
  async list(docId) {await this.ready;await this.recover(docId);return this.repository.list(docId);}
  preview({doc,scope,target,persistent=false,...config}) {
    const prompt=assemblePrompt(doc,scope,{...config,session:{mode:persistent?'start':'none'}});
    return {...prompt,...requestPreview(target,prompt.request)};
  }
  async launch({doc,scope,target,prompt,path,retained=[],initialSources=[],previousId=null,signal,onEvent,onBegin,onAttemptOutput,allowSavedExtraction=false}) {
    preflightRequest(target,prompt.request);
    const id=this.repository.id();
    return this.ownership.hold(id,async()=> {
      if(signal?.aborted)throw cancelled();
      const run=await this.repository.begin(doc,scope,prompt,target,{id,previousId,allowStale:!!previousId || allowSavedExtraction});
      try{await onBegin?.(run);}catch(error){await this.repository.interrupt(run.id,{code:'SETUP_FAILED',reason:error.message}).catch(()=>{});throw Object.assign(error,{runId:run.id});}
      return this.execute({run,doc,scope,prompt,path,retained,initialSources,signal,onEvent,onAttemptOutput});
    });
  }
  async start({doc,scope,target,persistent=false,followRunId=null,...config},{signal,onEvent,onBegin,onAttemptOutput,allowSavedExtraction=false}={}) {
    await this.ready;if(signal?.aborted)throw cancelled();
    doc=structuredClone(doc);scope=structuredClone(scope);target=structuredClone(target);
    const path=this.path(target);
    let prompt=assemblePrompt(doc,scope,{...config,session:{mode:persistent?'start':'none'}});
    preflightRequest(target,prompt.request);
    if(persistent) {
      const info=(await path.discover()).find(p=>p.provider===target.provider);
      if(!info?.capabilities.sessions)prompt=assemblePrompt(doc,scope,config);
      else if(followRunId){const prior=(await this.repository.get(followRunId))?.run;
        if(!prior || prior.docId!==doc.id || prior.extractionVersion!==doc.version || prior.scopeKey!==scopeKey(scope) || prior.promptVersion!==PROMPT_VERSION || ['path','provider','model','effort','serviceTier'].some(k=>(prior.target[k]??null)!==(target[k]??null)))throw Error('SESSION_CONTEXT_CHANGED');
        if(prior.status==='completed' && prior.session?.reusable!==false && SESSION_HANDLE.test(prior.session?.handle??''))prompt=assemblePrompt(doc,scope,{...config,session:{mode:'continue',handle:prior.session.handle}});
      }
    }
    return this.launch({doc,scope,target,prompt,path,signal,onEvent,onBegin,onAttemptOutput,allowSavedExtraction});
  }
  async prepareContinuation(id,{mode='auto',signal}={}) {
    if(!['auto','new'].includes(mode))throw Error('INVALID_CONTINUATION');
    await this.ready;if(signal?.aborted)throw cancelled();
    await this.recover();
    const saved=await this.repository.get(id);
    if(!saved || saved.run.status==='running' || saved.run.canContinue===false || !saved.run.metrics?.truncated || saved.run.continuedBy || this.active.has(id))throw Error('CONTINUATION_UNAVAILABLE');
    const previous=saved.run;
    if(previous.schemaVersion!==1 || previous.promptVersion!==PROMPT_VERSION)throw Error('PROMPT_VERSION_CHANGED');
    const doc=await this.store.getDocument(previous.docId,previous.extractionVersion);
    if(!doc)throw Error('DOCUMENT_REMOVED');
    const byNumber=new Map(doc.blocks.map(b=>[b.n,b]));
    const scope={...previous.scope,blocks:previous.scope.blocks.map(({n,...marks})=>({...byNumber.get(n),...marks}))};
    const path=this.path(previous.target);
    let session={mode:'none'};
    if(mode==='auto' && previous.session?.reusable!==false && typeof previous.session?.handle==='string' && SESSION_HANDLE.test(previous.session.handle)) {
      const info=(await path.discover()).find(p=>p.provider===previous.target.provider);
      if(info?.capabilities.sessions)session={mode:'continue',handle:previous.session.handle};
    }
    const prompt=assemblePrompt(doc,scope,{...previous.config,session});
    if(prompt.promptKey!==previous.promptKey)throw Error('CONTINUATION_CONFIG_CHANGED');
    prompt.request.task=continuationTask(prompt.request.task,saved.records,{session:session.mode==='continue'});
    return {doc,scope,target:previous.target,prompt,path,retained:saved.records,initialSources:previous.sources??[],previousId:id};
  }
  async previewContinuation(id,options) {
    const prepared=await this.prepareContinuation(id,options);
    return {...prepared.prompt,...requestPreview(prepared.target,prepared.prompt.request)};
  }
  async continue(id,{mode='auto',signal,onEvent}={}) {
    const prepared=await this.prepareContinuation(id,{mode,signal});
    return this.launch({...prepared,signal,onEvent});
  }
  cancel(id) {this.active.get(id)?.abort();}
  async execute({run,doc,scope,prompt,path,retained=[],initialSources=[],signal,onEvent,onAttemptOutput}) {
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    this.active.set(run.id,controller);
    const started=this.now();let firstRecordMs=null,terminalSent=false;
    let writes=Promise.resolve(),writeError=null,session=null;
    const handles=new Set(prompt.request.session.mode==='continue'?[prompt.request.session.handle]:[]);
    const enqueueOperation=operation=> {
      writes=writes.then(operation).catch(error=>{writeError??=error;controller.abort();});
    };
    const enqueue=(...args)=>enqueueOperation(()=>this.repository.write(run.id,...args));
    const remember=handle=> {
      handles.add(handle);
      enqueueOperation(async()=> {
        const exists=await this.store.rememberSession(run,handle);
        if(!exists) {
          Promise.resolve().then(()=>this.onMaintenanceNeeded()).catch(()=>{});
          throw Error('DOCUMENT_REMOVED');
        }
      });
    };
    const terminal=(status,details={})=> {
      if(!terminalSent){terminalSent=true;notify(onEvent,{type:'run',runId:run.id,status,...details});}
    };
    const attempts=[],sources=new Map();
    const rememberSource=source=>{const url=safeURL(source?.url);if(url && sources.size<200 && typeof source.title==='string')sources.set(url,{id:String(source.id??''),title:source.title.slice(0,1200),url,snippet:String(source.snippet??'').slice(0,4000)});};
    for(const source of initialSources)rememberSource(source);
    const attempt=async(request,index)=> {
      preflightRequest(run.target,request);
      let raw='',streamed='',result=null,error=null,contextLost=false,lostBeforeOutput=false;
      const turnController=new AbortController(),turnSignal=AbortSignal.any([combined,turnController.signal]);
      const createParser=()=>new RecordParser({lens:run.lens,blocks:scope.blocks,sections:doc.sections,now:this.now,customLens:run.config.customLens,sources,onRecord:entry=> {
        if(!entry.retained)firstRecordMs??=this.now()-started;
        if(index===0){enqueue({},[entry]);notify(onEvent,{type:'record',runId:run.id,attempt:index,entry});}
      }});
      let parser=createParser();if(retained.length)parser.seed(retained);
      try {
        result=await path.run(run.target,request,{signal:turnSignal,runId:run.id,databaseName:this.store.db.name,onEvent:event=> {
          if(event.type==='source' && request.kind==='search')rememberSource(event.source);
          if(event.type==='delta'){raw+=event.text;streamed+=event.text;if(!contextLost)parser.push(event.text);}
          if(event.type==='session' && request.session.mode!=='none' && typeof event.handle==='string' && SESSION_HANDLE.test(event.handle)) {
            session={handle:event.handle,...(contextLost?{reusable:false}:{})};remember(event.handle);enqueue({session});
          }
          if(event.type==='session_lost') {
            if(session)session={...session,reusable:false};
            enqueue({session});
            if(request.session.mode==='continue') {
              if(!contextLost)lostBeforeOutput=!raw;
              contextLost=true;if(lostBeforeOutput)turnController.abort();
            }
          }
          notify(onEvent,{...event,runId:run.id,attempt:index});
        }});
        if(request.kind==='search')for(const source of result.sources??[])rememberSource(source);
        if(!streamed && result.text){raw=result.text;if(!contextLost)parser.push(result.text);}
        else if(result.text!==undefined && result.text!==streamed)throw Error('PATH_TEXT_MISMATCH');
        if(request.session.mode!=='none' && typeof result.session==='string' && SESSION_HANDLE.test(result.session) && !contextLost) {
          session={handle:result.session};if(!handles.has(result.session))remember(result.session);
        }
      }catch(e){error=e;}
      if(contextLost) {
        error=combined.aborted?cancelled():new PathError('PROVIDER_FAILED','UNKNOWN_SESSION',false,{hint:'The session was lost. Continue as a new run to resend the scope.'});
        notify(onEvent,{type:'reset',runId:run.id});enqueue({},[],{replace:true});parser=createParser();parser.seed(retained);
      }
      const parsed=parser.finish({truncated:!!error || result?.truncated===true,usage:result?.usage??null});
      // Explicit evaluator hook includes final-only/non-streaming output. It is
      // observer-isolated and never persisted or exposed by ordinary UI runs.
      notify(onAttemptOutput,{attempt:index,raw});
      attempts.push({kind:request.kind,metrics:structuredClone(parsed.metrics),accepted:!error && acceptable(parsed.metrics),
        ...(error?{error:{code:error.code??'PROVIDER_FAILED',reason:error.reason??error.message}}:{})});
      await writes;if(writeError)throw writeError;
      return {...parsed,raw,result,error,canRebuild:error?.reason==='UNKNOWN_SESSION' && (!raw || lostBeforeOutput)};
    };
    notify(onEvent,{type:'run',runId:run.id,status:'running',version:run.version});
    let final;
    try {
      final=await attempt(prompt.request,0);
      if(final.canRebuild && !combined.aborted && prompt.request.session.mode==='continue') {
        notify(onEvent,{type:'session_reset',runId:run.id,hint:'The session was lost. The scope is being sent again.'});
        const fresh=assemblePrompt(doc,scope,{...run.config,session:{mode:'start'}});
        fresh.request.task=continuationTask(fresh.request.task,retained);
        preflightRequest(run.target,fresh.request);
        prompt.request=fresh.request;
        notify(onEvent,{type:'reset',runId:run.id});enqueue({},[],{replace:true});
        final=await attempt(prompt.request,0);
      }
      if(!final.error && !acceptable(final.metrics) && !combined.aborted) {
        const capped=final.result?.truncated===true;
        notify(onEvent,{type:'repairing',runId:run.id});
        let repaired;
        try{repaired=await attempt(repairRequest(run.lens,run.config.language,final.raw,run.cleanupGroup,run.config.customLens),1);}
        catch(error){
          if(writeError)throw writeError;
          repaired={error};attempts.push({kind:'repair',accepted:false,metrics:{usage:null,blocked:true},error:{code:error.code??'PROVIDER_FAILED',reason:error.reason??error.message}});
        }
        const enough=repaired.metrics?.newValidRecords>=final.metrics.newValidRecords;
        if(!repaired.error && acceptable(repaired.metrics) && enough) {
          final={...repaired,metrics:{...repaired.metrics,truncated:repaired.metrics.truncated || capped}};
          if(session)session={...session,reusable:false};
          notify(onEvent,{type:'reset',runId:run.id});
          for(const entry of final.records)notify(onEvent,{type:'record',runId:run.id,attempt:1,entry});
        }else{
          const reason=repaired.error?.code??(!enough?'FEWER_VALID_RECORDS':'INVALID_OUTPUT');
          if(attempts.at(-1)?.kind==='repair'){attempts.at(-1).accepted=false;attempts.at(-1).rejection=reason;}
          notify(onEvent,{type:'repair_failed',runId:run.id,code:reason});
        }
      }
      final={...final,metrics:structuredClone(final.metrics)};
      if(combined.aborted && !final.error){final.error=cancelled();final.metrics.truncated=true;}
      const status=final.error?(final.error.code==='CANCELLED'?'cancelled':'failed'):final.metrics.truncated?'truncated':acceptable(final.metrics)?'completed':'invalid';
      final.metrics.timeToFirstRecordMs=firstRecordMs;final.metrics.totalMs=this.now()-started;
      const usages=attempts.map(a=>a.metrics.usage).filter(Boolean);
      final.metrics.usage=usages.length?Object.fromEntries([...new Set(usages.flatMap(u=>Object.keys(u)))].map(k=>[k,usages.reduce((n,u)=>n+(Number.isFinite(u[k])?u[k]:0),0)])):null;
      const patch={status,metrics:final.metrics,attempts,...(run.config.operation==='situate'?{sources:[...sources.values()]}:{}),target:final.result?.target??run.target,session,sessionHandles:[...handles],
        canContinue:final.metrics.truncated && final.error?.code!=='TOO_LARGE',completedAt:Date.now(),
        ...(final.error?{error:{code:final.error.code??'PROVIDER_FAILED',reason:final.error.reason??final.error.message}}:{})};
      await writes;if(writeError)throw writeError;
      await this.repository.write(run.id,patch,final.records,{replace:true});
      terminal(status,{canContinue:patch.canContinue});
      const saved=await this.repository.get(run.id);
      if(final.error)throw Object.assign(final.error,{runId:run.id});
      return saved;
    }catch(error){
      if(!terminalSent){
        let status=error.message==='DOCUMENT_REMOVED'?'deleted':'failed';
        if(status!=='deleted') {
          const changed=await this.repository.interrupt(run.id,{code:error.code??'STORAGE_FAILED',reason:error.reason??error.message}).catch(()=>false);
          if(changed)status='interrupted';
        }
        terminal(status);
      }
      throw Object.assign(error,{runId:run.id});
    }finally{this.active.delete(run.id);}
  }
}
