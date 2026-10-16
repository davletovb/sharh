import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {PROMPT_VERSION} from '../src/analysis/prompts.mjs';
import {SeatlinePath} from '../src/paths/seatline.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {runEvaluation} from '../src/evaluation/run.mjs';
import {reviewForm,validateReviews} from '../src/evaluation/reviews.mjs';
import {fixtureBrowser} from './lib/browser-fixtures.mjs';
import {nativePort} from './lib/native-stdio.mjs';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {phaseOneOutput} from './lib/phase-one-fixtures.mjs';
import {phaseTwoOutput} from './lib/phase-two-fixtures.mjs';
import {evaluationFiles,protectInputs,writeEvaluationJSON,cleanupEvaluation} from './lib/evaluation-lifecycle.mjs';
import {PHASE_ONE_LENSES,PHASE_TWO_LENSES,PASSAGE_ACTIONS,OFFERED_ACTIONS} from '../src/analysis/lenses.mjs';
import {TASKS} from '../src/analysis/tasks.mjs';
const {values}=parseArgs({options:{'phase-two':{type:'boolean'},tasks:{type:'boolean'},task:{type:'string',multiple:true},'compare-tiers':{type:'boolean'},'quick-model':{type:'string'},'analysis-model':{type:'string'},fixture:{type:'boolean'},companion:{type:'string'},'fake-provider':{type:'string'},provider:{type:'string',multiple:true},lens:{type:'string',multiple:true},action:{type:'string',multiple:true},item:{type:'string',multiple:true},manifest:{type:'string',default:'corpus/manifest.json'},model:{type:'string'},language:{type:'string'},'no-passages':{type:'boolean'},'allow-gemini-cloud':{type:'boolean'},out:{type:'string'},report:{type:'string'},reviews:{type:'string'},'review-out':{type:'string'}}});
if(values['phase-two'] && !values.out && !values.report)values.out='test-results/g-evaluation.json';
if(values.tasks && !values.out && !values.report)values.out='test-results/task-evaluation.json';
if(values.tasks && values['phase-two'] || !values.tasks && (values.task || values['compare-tiers'] || values['quick-model'] || values['analysis-model']))throw Error('Use --tasks on its own, with --task, --compare-tiers, --quick-model and --analysis-model.');
const files=evaluationFiles(values);
if(values.report){
  if(!values.reviews || values.fixture || values.companion || values['fake-provider'])throw Error('Review mode requires --report FILE --reviews FILE, without generation flags.');
  await protectInputs([files.out],[values.report,values.reviews]);
  const report=JSON.parse(await readFile(values.report));report.expertReview=validateReviews(report,JSON.parse(await readFile(values.reviews)));
  report.phaseOneAccepted=false;report.phaseTwoAccepted=false;await writeEvaluationJSON(files.out,report);
  console.log(JSON.stringify({expertReview:report.expertReview,phaseOneAccepted:false,report:files.out}));process.exit(report.expertReview.complete && report.automaticPassed?0:1);
}
if(!!values.fixture===!!values.companion || values['fake-provider'] && !values.companion)throw Error('Use --fixture OR --companion PATH [--fake-provider PATH for isolated stand-ins].');
if(values.reviews)throw Error('Use --report FILE --reviews FILE to review existing output without new generation.');
const contract=JSON.parse(await readFile('config/seatline-contract.json')),manifest=JSON.parse(await readFile(values.manifest));
const providers=values.provider??['claude','codex'],items=manifest.items.filter(i=>!values.item || values.item.includes(i.id)),lenses=values.tasks?[]:values.lens??(values['phase-two']?PHASE_TWO_LENSES:PHASE_ONE_LENSES),actions=values.tasks||values['no-passages']?[]:values.action??(values['phase-two']?[]:[...OFFERED_ACTIONS]),tasks=values.tasks?values.task??Object.keys(TASKS):[];
if(!items.length || values.item?.some(id=>!items.some(i=>i.id===id)) || providers.some(p=>!contract.providers.includes(p)) || new Set(providers).size!==providers.length || lenses.some(l=>!(values['phase-two']?PHASE_TWO_LENSES:PHASE_ONE_LENSES).includes(l)) || actions.some(a=>!Object.hasOwn(PASSAGE_ACTIONS,a)) || values['no-passages'] && values.action || values['phase-two'] && values.action)throw Error('Invalid provider/item/lens/action filter.');
await protectInputs([files.out,files.form],[values.manifest,...items.map(i=>i.path)]);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
const kind=values.fixture?'scripted':values['fake-provider']?'real-broker-stand-ins':'live';
let store,browser,world,path,report={schemaVersion:1,id:crypto.randomUUID(),kind,sourceCommit,promptVersion:PROMPT_VERSION,workingTreeDirty:dirty,liveProviderClaim:false,automaticPassed:false,phaseOneAccepted:false,runs:[]};
const save=()=>writeEvaluationJSON(files.out,report);
try{
  // Generation needs extraction bundles. Review-only mode above never builds.
  execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
  store=await openDocumentStore({indexedDB:new IDBFactory(),name:'phase-one-evaluation'});
  browser=await fixtureBrowser({module:'/dist/evaluation.mjs'});
  if(values.fixture)path=new FakePath({wait:async()=>{},scriptFor:({request})=>{const task=JSON.parse(request.task.split('\n')[1]),fixture=values.tasks?(PHASE_ONE_LENSES.includes(task.lens)?phaseOneOutput:phaseTwoOutput):values['phase-two']?phaseTwoOutput:phaseOneOutput;return {text:fixture(task,JSON.parse(request.document))};}});
  else{
    if(values['fake-provider'])world=await isolatedCompanion(resolve(values.companion),resolve(values['fake-provider']));
    path=new SeatlinePath({connectNative:()=>nativePort(world?.installed??resolve(values.companion),world?.origin??`chrome-extension://${contract.development_extension_id}/`,world?.env??process.env),policy:()=>({allowGeminiCloud:values['allow-gemini-cloud']===true})});
  }
  const engine=new AnalysisEngine({store,paths:{seatline:path}});
  const extract=async item=>{const sha=createHash('sha256').update(await readFile(item.path)).digest('hex');if(item.sha256 && sha!==item.sha256)throw Error('CORPUS_HASH_MISMATCH');return browser.extract(item);};
  report=await runEvaluation({engine,store,items,providers,lenses,actions,tasks,compareTiers:values['compare-tiers']===true,models:{...(values['quick-model']?{quick:values['quick-model']}:{}),...(values['analysis-model']?{analysis:values['analysis-model']}:{})},extract,kind,sourceCommit,phase:values.tasks?'tasks':values['phase-two']?'two':'one',language:values.language,targets:Object.fromEntries(providers.map(provider=>[provider,{model:values.model??null}])),
    checkpoint:async value=>{report=value;report.workingTreeDirty=dirty;report.seatlineRevision=contract.revision;await save();}});
  report.expertReview={complete:false,reviewed:0,total:report.runs.length};
  await writeEvaluationJSON(files.form,reviewForm(report));
  if(!report.automaticPassed)process.exitCode=1;
}catch(error){report.automaticPassed=false;report.failure={code:error.code??'EVALUATION_FAILED',reason:error.reason??error.message};process.exitCode=1;}
finally{
  report.cleanup=await cleanupEvaluation({store,path,browser,world});if(!report.cleanup.completed)process.exitCode=1;
  try{await save();}catch(error){report.cleanup.errors.push({stage:'report-save',message:error.message});report.cleanup.completed=false;process.exitCode=1;}
  console.log(JSON.stringify({kind,automaticPassed:report.automaticPassed,phaseOneAccepted:false,runs:report.runs.length,cleanup:{completed:report.cleanup.completed,pending:report.cleanup.pending,errors:report.cleanup.errors},report:files.out,reviewForm:files.form,failure:report.failure}));
}
