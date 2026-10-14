import {stat,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {MaintenanceDispatcher} from '../../src/analysis/maintenance.mjs';
export function evaluationFiles(values){
  const out=values.out??(values.report?values.report.replace(/\.json$/i,'')+'.reviewed.json':'test-results/f-evaluation.json');
  return {out,form:values['review-out']??out.replace(/\.json$/i,'')+'.review.json'};
}
export async function protectInputs(outputs,inputs=[]){
  const paths=[...outputs,...inputs],stats=await Promise.all(paths.map(async path=>{try{return await stat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}));
  for(let i=0;i<outputs.length;i++)for(let j=i+1;j<paths.length;j++)if(resolve(paths[i])===resolve(paths[j]) || stats[i] && stats[j] && stats[i].dev===stats[j].dev && stats[i].ino===stats[j].ino)throw Error('OUTPUT_OVERWRITES_INPUT: Choose a separate report and review-form path.');
}
export async function writeEvaluationJSON(path,value){
  await mkdir(dirname(path),{recursive:true});const temporary=path+'.tmp-'+crypto.randomUUID();
  try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
export async function cleanupEvaluation({store,path,browser,world}){
  const cleanup={completed:false,pending:store?null:0,results:[],errors:[]};
  const step=async(stage,operation)=>{try{return await operation();}catch(error){cleanup.errors.push({stage,message:error.message??String(error)});}};
  if(store){
    const documents=await step('list-documents',()=>store.listDocuments());
    for(const doc of documents??[])await step('delete-document',()=>store.deleteDocument(doc.id));
    await step('maintenance',async()=>{cleanup.results=await new MaintenanceDispatcher(store,path?{seatline:path}:{}).drain();});
    await step('pending-maintenance',async()=>{cleanup.pending=(await store.all('maintenance')).length;});
  }
  // An earlier failure must not prevent later resources from closing.
  await step('path-close',()=>path?.client?.close());
  await step('store-close',()=>store?.close());
  await step('browser-close',()=>browser?.close());
  await step('world-close',()=>world?.close());
  cleanup.completed=cleanup.pending===0 && cleanup.errors.length===0;return cleanup;
}
