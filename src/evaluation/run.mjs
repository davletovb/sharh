import {createDocument} from '../documents/model.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {PROMPT_VERSION} from '../analysis/prompts.mjs';
import {PHASE_ONE_LENSES,PASSAGE_ACTIONS} from '../analysis/lenses.mjs';
import {portableRow} from '../documents/archive.mjs';
import {measureOutput,metricsPass,AUTOMATIC_TARGETS} from './metrics.mjs';
export async function runEvaluation({engine,store,items,providers,extract,kind,sourceCommit,lenses=PHASE_ONE_LENSES,actions=Object.keys(PASSAGE_ACTIONS),targets={},language=null,beforeRun=()=>{},checkpoint=()=>{}}){
  if(!['scripted','real-broker-stand-ins','live'].includes(kind) || !items.length || !providers.length || new Set(providers).size!==providers.length || new Set(items.map(i=>i.id)).size!==items.length || lenses.some(l=>!PHASE_ONE_LENSES.includes(l)) || actions.some(a=>!Object.hasOwn(PASSAGE_ACTIONS,a)) || new Set(lenses).size!==lenses.length || new Set(actions).size!==actions.length || !lenses.length && !actions.length)throw Error('INVALID_EVALUATION_MATRIX');
  const report={schemaVersion:1,id:crypto.randomUUID(),kind,liveProviderClaim:kind==='live',sourceCommit,promptVersion:PROMPT_VERSION,createdAt:new Date().toISOString(),targets:AUTOMATIC_TARGETS,
    matrix:{items:items.map(i=>i.id),providers,lenses,actions,expectedRuns:items.length*providers.length*(lenses.length+actions.length)},runs:[],automaticPassed:false,phaseOneAccepted:false,
    limitations:['Automatic checks cannot establish semantic faithfulness, actual output language, insight, translation quality or term-introduction accuracy.','Stand-ins do not establish live prompt-injection resistance.','Phase 1 also requires natural licensed corpus texts and the A/B/E owner gates.']};
  const cases=[...lenses.map(lens=>({lens,action:null})),...actions.map(action=>({action,lens:action==='Logic'?'logic':'passage'}))];
  for(const item of items){let doc,extractionError;try{doc=createDocument(await extract(item),{kind:item.format,identity:item.path,language:item.language});await store.saveDocument(doc);}catch(error){extractionError=error.message;}
    for(const provider of providers)for(const task of cases){const id=crypto.randomUUID(),row={id,item:item.id,provider,...task,language:language??item.language,outcome:'failed',rawAttempts:[],records:[]};report.runs.push(row);let saved,scope;
      try{
        if(extractionError)throw Error('EXTRACTION_FAILED: '+extractionError);
        const selected=doc.blocks.find(b=>b.kind==='para')??doc.blocks[0];scope=task.action?buildScope(doc,{kind:'selection',spans:[{n:selected.n,start:0,end:Math.min(selected.text.length,160)}]}):buildScope(doc);
        const config={doc,scope,...task,language:row.language,budget:task.lens==='structure'?200:24,target:{path:'seatline',provider,model:null,...targets[provider]},tier:task.action?'quick':'analysis',persistent:false,cleanupGroup:`eval-${report.id.slice(0,8)}-${doc.id.slice(0,16)}`};
        row.extractionVersion=doc.version;row.source={path:item.path,title:doc.title,language:doc.language,license:item.license??null,sha256:item.sha256??null};
        row.scope={kind:scope.kind,label:scope.label,blocks:scope.blocks.map(({n,kind,text,pageLabel,selected,context})=>({n,kind,text,...(pageLabel?{pageLabel}:{}),...(selected?{selected}:{}),...(context?{context}: {})}))};await beforeRun(config);
        try{saved=await engine.start(config,{onAttemptOutput:({attempt,raw})=>{row.rawAttempts[attempt]=raw;},onEvent:event=>{if(event.type==='delta'){const at=event.attempt??0;row.rawAttempts[at]??='';row.rawAttempts[at]+=event.text;}}});}
        catch(error){if(error.runId)saved=await engine.repository.get(error.runId);throw error;}
        row.outcome=saved.run.status==='completed'?'completed':saved.run.status;
      }catch(error){row.failure={code:error.code??'EVALUATION_FAILED',reason:error.reason??error.message};}
      if(saved){row.run=portableRow(saved.run);row.records=saved.records;row.rawAttempts=Array.from(row.rawAttempts,s=>s??'');
        row.metrics=measureOutput(row.rawAttempts[0]??'',{...task,language:row.language,doc,scope,expectedHeadings:item.expected?.headings??[],canary:item.canary,truncated:saved.run.attempts?.[0]?.metrics?.truncated??saved.run.metrics.truncated});
        row.metrics.timeToFirstRecordMs=saved.run.metrics.timeToFirstRecordMs;row.metrics.totalMs=saved.run.metrics.totalMs;row.passed=row.outcome==='completed' && metricsPass(row.metrics);
      }else row.passed=false;
      await checkpoint(report);
    }
  }
  report.automaticPassed=report.runs.length===report.matrix.expectedRuns && report.runs.every(r=>r.passed);return report;
}
