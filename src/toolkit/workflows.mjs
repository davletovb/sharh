import {assemblePrompt} from '../analysis/prompts.mjs';
import {scopeKey} from '../analysis/prompts.mjs';
import {assertCanonicalRecords} from '../analysis/contract.mjs';
import {alignThemes,alignLogic,namespaceRecords} from './alignment.mjs';
export function restoreScope(doc,descriptor){if(descriptor.docId!==doc.id || descriptor.version!==doc.version)throw Error('SAVED_SCOPE_CHANGED');const byN=new Map(doc.blocks.map(b=>[b.n,b]));return {...descriptor,blocks:descriptor.blocks.map(b=>{if(!byN.has(b.n))throw Error('SAVED_SCOPE_CHANGED');return {...byN.get(b.n),...b};})};}
export async function deepRead(engine,config,options={}){const saved=[];for(const lens of ['structure','logic','thinking']){if(options.signal?.aborted)throw Error('Deep read stopped. Completed lenses are saved.');await options.onLens?.(lens);const result=await engine.start({...config,lens,customLens:null,operation:null,action:null,followRunId:saved.at(-1)?.run.id??null},options);saved.push(result);if(result.run.status!=='completed')break;}return saved;}
export async function secondReader(engine,config,otherTarget,options={}){
  if(!['themes','logic'].includes(config.lens))throw Error('Choose Themes or Logic for Second reader.');
  if(['path','provider','model','effort','serviceTier'].every(k=>(config.target[k]??null)===(otherTarget[k]??null)))throw Error('Choose two different reader targets.');
  const outputs=[];for(const target of [config.target,otherTarget]){if(options.signal?.aborted)throw Error('Second reader stopped. Completed readings are saved.');await options.onLens?.(config.lens);outputs.push(await engine.start({...config,target,persistent:false,followRunId:null},options));}
  if(outputs.some(s=>s.run.status!=='completed'))throw Error('A reader returned a partial/invalid response. Both readings remain in history; retry before alignment.');
  const alignment=config.lens==='themes'?alignThemes(outputs[0].records,outputs[1].records,config.scope.blocks.map(b=>b.n)):alignLogic(outputs[0].records,outputs[1].records),id=crypto.randomUUID();
  const pair={id,kind:'second-reader',docId:config.doc.id,extractionVersion:config.doc.version,lens:config.lens,sourceRuns:outputs.map(s=>s.run.id),createdAt:Date.now()};await engine.store.writeOwned('jobs',pair);return {pair,outputs,alignment};
}
export async function reconcile(engine,{doc,scope,pair,outputs,selected}){
  if(pair.docId!==doc.id || pair.extractionVersion!==doc.version || outputs.length!==2 || pair.sourceRuns.length!==2 || outputs.some((s,i)=>s.run.id!==pair.sourceRuns[i] || s.run.docId!==doc.id || s.run.extractionVersion!==doc.version || s.run.lens!==pair.lens || s.run.scopeKey!==scopeKey(scope)))throw Error('RECONCILIATION_SCOPE_CHANGED');
  const candidates=outputs.flatMap((s,i)=>namespaceRecords(s.records,i?'R':'L').map(e=>({...e,choice:`${i}:${e.sequence}`}))),entries=candidates.filter(e=>selected.includes(e.choice)).map(({choice,...e},i)=>({...e,sequence:i+1}));if(!entries.length)throw Error('Choose findings to keep.');
  try{assertCanonicalRecords(entries,pair.lens,{scope:new Set(scope.blocks.map(b=>b.n)),sections:doc.sections});}catch{throw Error('Keep the findings referenced by selected codes, excerpts or links too.');}
  const prompt=assemblePrompt(doc,scope,{lens:pair.lens}),run=await engine.repository.begin(doc,scope,prompt,{path:'local',provider:'reconciled'},{allowStale:true});
  await engine.repository.write(run.id,{status:'completed',sourceRuns:pair.sourceRuns,origin:'human-reconciliation',metrics:{truncated:false,validRecords:entries.length,newValidRecords:entries.length,validRate:1},canContinue:false,completedAt:Date.now()},entries,{replace:true});
  await engine.store.writeOwned('jobs',{...pair,reconciledRunId:run.id});return engine.repository.get(run.id);
}
