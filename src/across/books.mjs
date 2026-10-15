import {scopeDescriptor,assemblePrompt,PROMPT_VERSION,scopeKey} from '../analysis/prompts.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {chapterSections} from '../documents/model.mjs';
import {restoreScope} from '../toolkit/workflows.mjs';
import {runWithFailover,targetKey,validateFailover} from './failover.mjs';
import {glossarySnapshot,Glossary} from './glossary.mjs';
import {transaction,idbRequest as read} from '../documents/idb.mjs';
export function chapterPlan(doc,scope=buildScope(doc)){
 if(!['document','section','chapter'].includes(scope.kind)||scope.docId!==doc.id||scope.version!==doc.version||!scope.blocks.length)throw Error('Choose a document or chapter for a book job.');
 const first=scope.blocks[0].n,last=scope.blocks.at(-1).n,starts=[...new Set([first,...chapterSections(doc).map(s=>s.first).filter(n=>n>first&&n<=last)])].sort((a,b)=>a-b);
 return starts.map((n,i)=>{const end=(starts[i+1]??last+1)-1,title=doc.sections.find(s=>s.first===n&&s.level===doc.chapterLevel)?.title??(n===first?scope.label:`¶${n}–${end}`);return {title,span:[n,end],scope:scopeDescriptor({...scope,kind:'chapter',label:title,blocks:scope.blocks.filter(b=>b.n>=n&&b.n<=end)})};});
}
export class BookJobs {
 constructor(engine){this.engine=engine;this.store=engine.store;}
 async list(docId){return (await this.store.all('jobs')).filter(j=>j.kind==='book'&&(!docId||j.docId===docId)).sort((a,b)=>b.createdAt-a.createdAt);}
 async create(config,{policy={mode:'ask',targets:[]}}={}){
  const doc=config.doc,scope=config.scope??buildScope(doc),glossary=config.glossary??glossarySnapshot(await new Glossary(this.store).list(doc.id),config.language??'en'),job={id:crypto.randomUUID(),kind:'book',docId:doc.id,extractionVersion:doc.version,scope:scopeDescriptor(scope),promptVersion:PROMPT_VERSION,chapters:chapterPlan(doc,scope),config:{language:config.language??'en',budget:config.budget??48,focus:config.focus??'',frame:config.frame??'',glossary},target:structuredClone(config.target),policy:validateFailover(policy),state:'paused',createdAt:Date.now(),updatedAt:Date.now()};
  await this.store.writeOwned('jobs',job);return job;
 }
 async get(id){const job=(await this.store.all('jobs')).find(j=>j.id===id&&j.kind==='book');if(!job)throw Error('BOOK_JOB_REMOVED');return job;}
 async write(job){return transaction(this.store.db,['docs','jobs'],'readwrite',async tx=>{if(!await read(tx.objectStore('jobs').getKey(job.id))||!await read(tx.objectStore('docs').getKey(job.docId)))throw Error('BOOK_JOB_REMOVED');tx.objectStore('jobs').put({...job,updatedAt:Date.now()});});}
 async cached(config,targets){const prompt=assemblePrompt(config.doc,config.scope,config),allowed=new Set(targets.map(targetKey));const runs=await this.engine.list(config.doc.id);for(const run of runs)if(run.status==='completed'&&run.lens==='digest'&&run.extractionVersion===config.doc.version&&run.scopeKey===scopeKey(config.scope)&&run.promptKey===prompt.promptKey&&allowed.has(targetKey(run.target)))return this.engine.repository.get(run.id);return null;}
 async run(id,options={}){
  const result=await this.engine.ownership.hold('book-background',async()=>{
   let job=await this.get(id);if(job.promptVersion!==PROMPT_VERSION)throw Error('The digest prompt changed. Start a new book job.');const doc=await this.store.getDocument(job.docId,job.extractionVersion);if(!doc)throw Error('DOCUMENT_REMOVED');job={...job,state:'running',error:null};await this.write(job);options.onProgress?.(job);
   try{for(const [index,chapter]of job.chapters.entries()){
    if(options.signal?.aborted)throw Object.assign(Error('Book job paused.'),{code:'CANCELLED'});
    const config={...job.config,doc,scope:restoreScope(doc,chapter.scope),target:job.target,lens:'digest',tier:'analysis',priority:'background',persistent:false};
    let saved=await this.cached(config,[job.target,...job.policy.targets,...job.chapters.filter(c=>c.target).map(c=>c.target)]);
    if(!saved){let pending=chapter.runId?await this.engine.repository.get(chapter.runId):null;
     const ambiguousId=pending?.run.status==='interrupted'&&!pending.records.length?pending.run.id:null;
     if(ambiguousId&&options.restartInterruptedRunId!==ambiguousId)throw Object.assign(Error('This chapter may already have been sent. No output was saved. Explicitly restart the interrupted chapter only if you accept possible repeated usage.'),{code:'AMBIGUOUS_CHAPTER',runId:ambiguousId});
     const onBegin=async run=>{if(ambiguousId)await this.engine.repository.write(run.id,{restartedRunId:ambiguousId});chapter.runId=run.id;await this.write(job);await options.onBegin?.(run);};
     if(ambiguousId)pending=null;
     if(pending?.run.canContinue&&pending.run.metrics?.truncated&&!pending.run.continuedBy&&(pending.run.metrics.outputBytes>0||pending.records.length)){saved=await this.engine.continue(pending.run.id,{...options,onBegin,mode:'new'});}
     else saved=await runWithFailover(this.engine,config,job.policy,{...options,onBegin,allowSavedExtraction:true,onFailover:event=>{job.target=event.to;options.onFailover?.(event);}});
    }
    chapter.runId=saved.run.id;chapter.target=saved.run.target;job.target=saved.run.target;chapter.completed=saved.run.status==='completed';job.next=chapter.completed?index+1:index;job.mixedTargets=new Set(job.chapters.filter(c=>c.target).map(c=>targetKey(c.target))).size>1;
    if(saved.run.status!=='completed'){job.state='paused';job.error={code:'INCOMPLETE_CHAPTER',message:'Continue this chapter before digesting the next one.'};await this.write(job);options.onProgress?.(job);return job;}
    await this.write(job);options.onProgress?.(job);
   }job.state='completed';await this.write(job);options.onProgress?.(job);return job;
   }catch(error){job.state='paused';job.error={code:error.code??'JOB_FAILED',message:error.hint??error.message,runId:error.runId??null};await this.write(job).catch(()=>{});options.onProgress?.(job);throw Object.assign(error,{jobId:job.id});}
  },{ifAvailable:true});if(!result)throw Error('Another book job is active. Pause it before starting this one.');return result;
 }
 async digests(id){const job=await this.get(id);if(job.state!=='completed')throw Error('Finish the chapter digests first.');const chapters=[];for(const c of job.chapters){const saved=await this.engine.repository.get(c.runId);if(!saved||saved.run.status!=='completed'||saved.run.extractionVersion!==job.extractionVersion||saved.run.lens!=='digest')throw Error('A saved digest is missing. Resume the book job.');chapters.push({title:c.title,span:c.span,runId:c.runId,target:saved.run.target,records:saved.records});}return {job,chapters};}
 async synthesize(id,config,options={}){if(!['summary','structure','logic','thinking'].includes(config.lens))throw Error('Choose Summary, Structure, Logic or Thinking.');const {job,chapters}=await this.digests(id),doc=await this.store.getDocument(job.docId,job.extractionVersion),glossary=glossarySnapshot(await new Glossary(this.store).list(job.docId),config.language??'en');const {policy={mode:'ask',targets:[]},...base}=config;return runWithFailover(this.engine,{...base,doc,scope:restoreScope(doc,job.scope),digests:chapters,operation:null,customLens:null,action:null,priority:'interactive',tier:'synthesis',persistent:false,glossary},policy,options);}
}
