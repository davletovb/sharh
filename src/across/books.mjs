import {scopeDescriptor,assemblePrompt,PROMPT_VERSION,scopeKey} from '../analysis/prompts.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {chapterSections,contentHash} from '../documents/model.mjs';
import {restoreScope} from '../toolkit/workflows.mjs';
import {runWithFailover,targetKey,validateFailover} from './failover.mjs';
import {glossarySnapshot,Glossary} from './glossary.mjs';
import {transaction,idbRequest as read} from '../documents/idb.mjs';
export function chapterPlan(doc,scope=buildScope(doc)){
 if(!['document','section','chapter'].includes(scope.kind)||scope.docId!==doc.id||scope.version!==doc.version||!scope.blocks.length)throw Error('Choose a document or chapter for a book job.');
 const first=scope.blocks[0].n,last=scope.blocks.at(-1).n,starts=[...new Set([first,...chapterSections(doc).map(s=>s.first).filter(n=>n>first&&n<=last)])].sort((a,b)=>a-b);
 return starts.map((n,i)=>{const end=(starts[i+1]??last+1)-1,title=doc.sections.find(s=>s.first===n&&s.level===doc.chapterLevel)?.title??(n===first?scope.label:`¶${n}–${end}`);return {title,span:[n,end],scope:scopeDescriptor({...scope,kind:'chapter',label:title,blocks:scope.blocks.filter(b=>b.n>=n&&b.n<=end)})};});
}
const manifestKey=job=>contentHash(new TextEncoder().encode(JSON.stringify([job.extractionVersion,scopeKey(job.scope),job.promptVersion,job.config,targetKey(job.requestedTarget??job.target),job.policy.mode,job.policy.targets.map(targetKey),job.chapters.map(c=>[c.title,c.scope])])));
export class BookJobs {
 constructor(engine){this.engine=engine;this.store=engine.store;}
 async recover(rows){
  if(!rows.some(j=>j.state==='running'))return rows;
  const recovered=await this.engine.ownership.hold('book-background',async()=>{
   await this.engine.recover();
   return transaction(this.store.db,'jobs','readwrite',async tx=>{const result=[];for(const row of rows){const current=await read(tx.objectStore('jobs').get(row.id));if(!current)continue;if(current.state==='running'){current.state='paused';current.error={code:'OWNER_CLOSED',message:'The previous page closed. Resume to check the saved chapter before sending anything.'};current.updatedAt=Date.now();tx.objectStore('jobs').put(current);}result.push(current);}return result;});
  },{ifAvailable:true});return recovered??rows;
 }
 async list(docId){const rows=await transaction(this.store.db,'jobs','readonly',tx=>read(docId?tx.objectStore('jobs').index('docId').getAll(docId):tx.objectStore('jobs').getAll()));return (await this.recover(rows.filter(j=>j.kind==='book'))).sort((a,b)=>b.createdAt-a.createdAt);}
 plan(doc,scope,config){
  const result=[];
  for(const chapter of chapterPlan(doc,scope)){
   const full=restoreScope(doc,chapter.scope),fits=(blocks,label=full.label)=>this.engine.preview({...config,doc,scope:{...full,label,blocks},lens:'digest',tier:'analysis',priority:'background',persistent:false}).fits;
   if(fits(full.blocks)){result.push(chapter);continue;}
   let start=0,part=0;
   while(start<full.blocks.length){let low=1,high=full.blocks.length-start,best=0;while(low<=high){const count=Math.floor((low+high)/2);if(fits(full.blocks.slice(start,start+count),full.label+' · part 1000')){best=count;low=count+1;}else high=count-1;}
    if(!best)throw Object.assign(Error(`Paragraph ${full.blocks[start].n} is too large for a chapter request. Choose a smaller source before creating a book job.`),{code:'TOO_LARGE'});
    const blocks=full.blocks.slice(start,start+best),title=chapter.title+' · part '+(++part);result.push({title,span:[blocks[0].n,blocks.at(-1).n],scope:scopeDescriptor({...full,label:title,blocks})});start+=best;
   }
  }if(result.length>1000)throw Error('Choose a smaller scope before creating more than 1000 chapter parts.');return result;
 }
 async create(config,{policy={mode:'ask',targets:[]}}={}){
  const doc=config.doc,scope=config.scope??buildScope(doc),glossary=config.glossary??glossarySnapshot(await new Glossary(this.store).list(doc.id),config.language??'en'),frozen={language:config.language??'en',budget:config.budget??48,focus:config.focus??'',frame:config.frame??'',glossary},job={id:crypto.randomUUID(),kind:'book',docId:doc.id,extractionVersion:doc.version,scope:scopeDescriptor(scope),promptVersion:PROMPT_VERSION,chapters:this.plan(doc,scope,{...frozen,target:config.target}),config:frozen,target:structuredClone(config.target),requestedTarget:structuredClone(config.target),policy:validateFailover(policy),state:'paused',createdAt:Date.now(),updatedAt:Date.now()};
  job.manifestKey=manifestKey(job);
  return transaction(this.store.db,['docs','jobs'],'readwrite',async tx=>{if(!await read(tx.objectStore('docs').getKey(doc.id)))throw Error('DOCUMENT_REMOVED');const rows=await read(tx.objectStore('jobs').index('docId').getAll(doc.id)),existing=rows.find(j=>j.kind==='book'&&(j.manifestKey??manifestKey(j))===job.manifestKey);if(existing)return existing;tx.objectStore('jobs').add(job);return job;});
 }
 async get(id){const job=await transaction(this.store.db,'jobs','readonly',tx=>read(tx.objectStore('jobs').get(id)));if(!job||job.kind!=='book')throw Error('BOOK_JOB_REMOVED');const rows=await this.recover([job]);if(!rows.length)throw Error('BOOK_JOB_REMOVED');return rows[0];}
 async write(job){return transaction(this.store.db,['docs','jobs'],'readwrite',async tx=>{if(!await read(tx.objectStore('jobs').getKey(job.id))||!await read(tx.objectStore('docs').getKey(job.docId)))throw Error('BOOK_JOB_REMOVED');tx.objectStore('jobs').put({...job,updatedAt:Date.now()});});}
 async cached(config,targets,cache){const candidates=cache.get(scopeKey(config.scope));if(!candidates)return null;const prompt=assemblePrompt(config.doc,config.scope,config,{includeDocument:false});for(const target of targets){const run=candidates.get(prompt.promptKey+targetKey(target));if(run)return this.engine.repository.get(run.id);}return null;}
 async run(id,options={}){
  const result=await this.engine.ownership.hold('book-background',async()=>{
   let job=await this.get(id);if(job.promptVersion!==PROMPT_VERSION)throw Error('The digest prompt changed. Start a new book job.');const doc=await this.store.getDocument(job.docId,job.extractionVersion);if(!doc)throw Error('DOCUMENT_REMOVED');job={...job,state:'running',error:null};await this.write(job);options.onProgress?.(job);
   try{const runs=await this.engine.list(doc.id),cache=new Map(),remember=run=>{const candidates=cache.get(run.scopeKey)??new Map(),key=run.promptKey+targetKey(run.target);if(!candidates.has(key))candidates.set(key,run);cache.set(run.scopeKey,candidates);};for(const run of runs)if(run.status==='completed'&&run.lens==='digest'&&run.extractionVersion===doc.version)remember(run);
    for(const [index,chapter]of job.chapters.entries()){
    if(options.signal?.aborted)throw Object.assign(Error('Book job paused.'),{code:'CANCELLED'});
    const config={...job.config,doc,scope:restoreScope(doc,chapter.scope),target:job.target,lens:'digest',tier:'analysis',priority:'background',persistent:false};
    let saved=await this.cached(config,[job.target,...job.policy.targets,...job.chapters.filter(c=>c.target).map(c=>c.target)],cache);
    if(!saved){let pending=chapter.runId?await this.engine.repository.get(chapter.runId):null;
     const chapterKey=scopeKey(config.scope),ambiguous=pending?.run.status==='interrupted'&&!pending.records.length&&!pending.run.restartedBy?pending.run:runs.find(r=>r.lens==='digest'&&r.extractionVersion===doc.version&&r.scopeKey===chapterKey&&r.status==='interrupted'&&r.metrics?.validRecords===0&&!r.restartedBy),ambiguousId=ambiguous?.id??null;
     if(ambiguousId&&options.restartInterruptedRunId!==ambiguousId)throw Object.assign(Error('This chapter may already have been sent. No output was saved. Explicitly restart the interrupted chapter only if you accept possible repeated usage.'),{code:'AMBIGUOUS_CHAPTER',runId:ambiguousId});
     const onBegin=async run=>{chapter.runId=run.id;await this.write(job);if(ambiguousId){await this.engine.repository.write(run.id,{restartedRunId:ambiguousId});await this.engine.repository.write(ambiguousId,{restartedBy:run.id});ambiguous.restartedBy=run.id;}await options.onBegin?.(run);};
     if(ambiguousId)pending=null;
     if(pending?.run.canContinue&&pending.run.metrics?.truncated&&!pending.run.continuedBy&&(pending.run.metrics.outputBytes>0||pending.records.length)){saved=await this.engine.continue(pending.run.id,{...options,onBegin,mode:'new'});}
     else saved=await runWithFailover(this.engine,config,job.policy,{...options,onBegin,allowSavedExtraction:true,onFailover:event=>{job.target=event.to;options.onFailover?.(event);}});
    }
    chapter.runId=saved.run.id;chapter.target=saved.run.target;job.target=saved.run.target;chapter.completed=saved.run.status==='completed';job.next=chapter.completed?index+1:index;job.mixedTargets=new Set(job.chapters.filter(c=>c.target).map(c=>targetKey(c.target))).size>1;
    if(chapter.completed)remember(saved.run);
    if(saved.run.status!=='completed'){job.state='paused';job.error={code:'INCOMPLETE_CHAPTER',message:'Continue this chapter before digesting the next one.'};await this.write(job);options.onProgress?.(job);return job;}
    await this.write(job);options.onProgress?.(job);
   }job.state='completed';await this.write(job);options.onProgress?.(job);return job;
   }catch(error){job.state='paused';job.error={code:error.code??'JOB_FAILED',message:error.hint??error.message,runId:error.runId??null};await this.write(job).catch(()=>{});options.onProgress?.(job);throw Object.assign(error,{jobId:job.id});}
  },{ifAvailable:true});if(!result)throw Error('Another book job is active. Pause it before starting this one.');return result;
 }
 async digests(id){const job=await this.get(id);if(job.state!=='completed')throw Error('Finish the chapter digests first.');const chapters=[];for(const c of job.chapters){const saved=await this.engine.repository.get(c.runId);if(!saved||saved.run.status!=='completed'||saved.run.extractionVersion!==job.extractionVersion||saved.run.lens!=='digest')throw Error('A saved digest is missing. Resume the book job.');chapters.push({title:c.title,span:c.span,runId:c.runId,target:saved.run.target,records:saved.records});}return {job,chapters};}
 async synthesize(id,config,options={}){if(!['summary','structure','logic','thinking'].includes(config.lens))throw Error('Choose Summary, Structure, Logic or Thinking.');const {job,chapters}=await this.digests(id),doc=await this.store.getDocument(job.docId,job.extractionVersion),glossary=glossarySnapshot(await new Glossary(this.store).list(job.docId),config.language??'en');const {policy={mode:'ask',targets:[]},...base}=config;return runWithFailover(this.engine,{...base,doc,scope:restoreScope(doc,job.scope),digests:chapters,operation:null,customLens:null,action:null,priority:'interactive',tier:'synthesis',persistent:false,glossary},policy,{...options,allowSavedExtraction:true});}
}
