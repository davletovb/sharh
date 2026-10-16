import {createDocument} from '../documents/model.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {PROMPT_VERSION} from '../analysis/prompts.mjs';
import {PHASE_ONE_LENSES,PHASE_TWO_LENSES,PASSAGE_ACTIONS,OFFERED_ACTIONS,passageLens} from '../analysis/lenses.mjs';
import {portableRow} from '../documents/archive.mjs';
import {measureOutput,metricsPass,AUTOMATIC_TARGETS} from './metrics.mjs';
import {TASKS,TASK_TIERS} from '../analysis/tasks.mjs';
export function evaluationScope(doc,action=null){
  if(!action)return buildScope(doc);
  const block=doc.blocks.find(b=>b.kind==='para')??doc.blocks[0];
  const term=action==='Define'?block.text.match(/\p{L}{4,}/u)??block.text.match(/[\p{L}\p{N}]+/u):null;
  const start=term?.index??0,end=term?start+term[0].length:[...block.text].slice(0,160).join('').length;
  return buildScope(doc,{kind:'selection',spans:[{n:block.n,start,end}]});
}
// The tasks phase runs the conversation's own readings (see src/analysis/tasks.mjs) with their task-level checks. Each runs on its
// declared tier, or on both tiers side by side when compareTiers is set, with an optional model per tier, so a real run can show
// whether Quick is good enough for a task before its tier is kept.
export async function runEvaluation({engine,store,items,providers,extract,kind,sourceCommit,lenses=PHASE_ONE_LENSES,actions=[...OFFERED_ACTIONS],tasks=[],compareTiers=false,models={},targets={},language=null,phase='one',beforeRun=()=>{},checkpoint=()=>{}}){
  const tasksPhase=phase==='tasks',catalog=phase==='two'?PHASE_TWO_LENSES:PHASE_ONE_LENSES;
  if(!['one','two','tasks'].includes(phase) || !['scripted','real-broker-stand-ins','live'].includes(kind) || !items.length || !providers.length || new Set(providers).size!==providers.length || new Set(items.map(i=>i.id)).size!==items.length
    || (tasksPhase?(lenses.length||actions.length||!tasks.length||tasks.some(t=>!Object.hasOwn(TASKS,t))||new Set(tasks).size!==tasks.length||Object.keys(models).some(t=>!TASK_TIERS.includes(t))):(tasks.length||compareTiers||lenses.some(l=>!catalog.includes(l))||actions.some(a=>!Object.hasOwn(PASSAGE_ACTIONS,a))||new Set(lenses).size!==lenses.length||new Set(actions).size!==actions.length||!lenses.length&&!actions.length))
    )throw Error('INVALID_EVALUATION_MATRIX');
  const report={schemaVersion:1,id:crypto.randomUUID(),kind,phase,phaseTwoAccepted:false,liveProviderClaim:kind==='live',sourceCommit,promptVersion:PROMPT_VERSION,createdAt:new Date().toISOString(),targets:AUTOMATIC_TARGETS,
    matrix:{items:items.map(i=>i.id),providers,lenses,actions,...(tasksPhase?{tasks,tiers:compareTiers?[...TASK_TIERS]:'declared',models}:{}),expectedRuns:items.length*providers.length*(lenses.length+actions.length+(tasksPhase?tasks.length*(compareTiers?TASK_TIERS.length:1):0))},runs:[],automaticPassed:false,phaseOneAccepted:false,
    limitations:['Automatic checks cannot establish semantic faithfulness, actual output language, insight, translation quality or term-introduction accuracy.','Stand-ins do not establish live prompt-injection resistance.','Phase 1 also requires natural licensed corpus texts and the A/B/E owner gates.']};
  const cases=[...lenses.map(lens=>({lens,action:null})),...actions.map(action=>({action,lens:passageLens(action)})),...tasks.flatMap(id=>(compareTiers?TASK_TIERS:[TASKS[id].tier]).map(tier=>({task:id,tier,lens:TASKS[id].lens,operation:TASKS[id].operation??null,action:null})))];
  for(const item of items){let doc,extractionError;try{doc=createDocument(await extract(item),{kind:item.format,identity:item.path,language:item.language});await store.saveDocument(doc);}catch(error){extractionError=error.message;}
    for(const provider of providers)for(const task of cases){const id=crypto.randomUUID(),row={id,item:item.id,provider,...task,language:language??item.language??'en',outcome:'failed',rawAttempts:[],records:[]};report.runs.push(row);let saved,scope,budget;const {task:taskId=null,tier:caseTier=null,...caseConfig}=task,declared=taskId?TASKS[taskId]:null;
      try{
        if(extractionError)throw Error('EXTRACTION_FAILED: '+extractionError);
        scope=evaluationScope(doc,task.action);
        const config={doc,scope,...caseConfig,language:row.language,budget:declared?.budget??(task.lens==='structure'?200:24),target:{path:'seatline',provider,model:null,...targets[provider],...(models[caseTier]?{model:models[caseTier]}:{})},tier:caseTier??(task.action?'quick':'analysis'),persistent:false,cleanupGroup:`eval-${report.id.slice(0,8)}-${doc.id.slice(0,16)}`};
        budget=config.budget;
        row.extractionVersion=doc.version;row.source={path:item.path,title:doc.title,language:doc.language,license:item.license??null,sha256:item.sha256??null};
        row.scope={kind:scope.kind,label:scope.label,blocks:scope.blocks.map(({n,kind,text,pageLabel,selected,context})=>({n,kind,text,...(pageLabel?{pageLabel}:{}),...(selected?{selected}:{}),...(context?{context}: {})}))};await beforeRun(config);
        try{saved=await engine.start(config,{onAttemptOutput:({attempt,raw})=>{row.rawAttempts[attempt]=raw;}});}
        catch(error){if(error.runId)saved=await engine.repository.get(error.runId);throw error;}
        row.outcome=saved.run.status==='completed'?'completed':saved.run.status;
      }catch(error){row.failure={code:error.code??'EVALUATION_FAILED',reason:error.reason??error.message};}
      if(saved){row.run=portableRow(saved.run);row.records=saved.records;row.rawAttempts=Array.from(row.rawAttempts,s=>s??'');
        row.metrics=measureOutput(row.rawAttempts[0]??'',{...caseConfig,taskId,language:row.language,budget,doc,scope,expectedHeadings:item.expected?.headings??[],canary:item.canary,truncated:saved.run.attempts?.[0]?.metrics?.truncated??saved.run.metrics.truncated});
        row.metrics.timeToFirstRecordMs=saved.run.metrics.timeToFirstRecordMs;row.metrics.totalMs=saved.run.metrics.totalMs;row.passed=row.outcome==='completed' && metricsPass(row.metrics);
      }else row.passed=false;
      await checkpoint(report);
    }
  }
  if(tasksPhase&&compareTiers)report.comparison=compareTierRows(report.runs);
  report.automaticPassed=report.runs.length===report.matrix.expectedRuns && report.runs.every(r=>r.passed);return report;
}

// Side by side, per item, provider and task: did each tier pass the checks, what did it miss, and how large and slow was it.
export function compareTierRows(runs) {
  const groups=new Map();
  for(const r of runs.filter(r=>r.task&&r.tier)){const key=[r.item,r.provider,r.task].join('|'),group=groups.get(key)??{item:r.item,provider:r.provider,task:r.task,declared:TASKS[r.task].tier};
    group[r.tier]={passed:r.passed===true,outcome:r.outcome,records:r.metrics?.findingRecords??null,missing:r.metrics?.missing??[],totalMs:r.metrics?.totalMs??null};groups.set(key,group);}
  return [...groups.values()].map(g=>({...g,verdict:g.quick&&g.analysis?(g.quick.passed&&g.analysis.passed?'both_pass':!g.quick.passed&&g.analysis.passed?'quick_falls_short':g.quick.passed?'only_quick_passes':'both_fail'):'incomplete'}));
}
