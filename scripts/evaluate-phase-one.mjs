import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {MaintenanceDispatcher} from '../src/analysis/maintenance.mjs';
import {SeatlinePath} from '../src/paths/seatline.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {runEvaluation} from '../src/evaluation/run.mjs';
import {reviewForm,validateReviews} from '../src/evaluation/reviews.mjs';
import {fixtureBrowser} from './lib/browser-fixtures.mjs';
import {nativePort} from './lib/native-stdio.mjs';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {phaseOneOutput} from './lib/phase-one-fixtures.mjs';
import {PHASE_ONE_LENSES,PASSAGE_ACTIONS} from '../src/analysis/lenses.mjs';
const {values}=parseArgs({options:{fixture:{type:'boolean'},companion:{type:'string'},'fake-provider':{type:'string'},provider:{type:'string',multiple:true},lens:{type:'string',multiple:true},action:{type:'string',multiple:true},item:{type:'string',multiple:true},manifest:{type:'string',default:'corpus/manifest.json'},model:{type:'string'},language:{type:'string'},'no-passages':{type:'boolean'},'allow-gemini-cloud':{type:'boolean'},out:{type:'string',default:'test-results/f-evaluation.json'},report:{type:'string'},reviews:{type:'string'},'review-out':{type:'string'}}});
if(values.report){
  if(!values.reviews || values.fixture || values.companion || values['fake-provider'])throw Error('Review mode requires --report FILE --reviews FILE, without generation flags.');
  const report=JSON.parse(await readFile(values.report));report.expertReview=validateReviews(report,JSON.parse(await readFile(values.reviews)));
  report.phaseOneAccepted=false;await mkdir(dirname(values.out),{recursive:true});await writeFile(values.out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({expertReview:report.expertReview,phaseOneAccepted:false,report:values.out}));process.exit(report.expertReview.complete && report.automaticPassed?0:1);
}
if(!!values.fixture===!!values.companion || values['fake-provider'] && !values.companion)throw Error('Use --fixture OR --companion PATH [--fake-provider PATH for isolated stand-ins].');
if(values.reviews)throw Error('Use --report FILE --reviews FILE to review existing output without new generation.');
const contract=JSON.parse(await readFile('config/seatline-contract.json')),manifest=JSON.parse(await readFile(values.manifest));
const providers=values.provider??['claude','codex'],items=manifest.items.filter(i=>!values.item || values.item.includes(i.id)),lenses=values.lens??PHASE_ONE_LENSES,actions=values['no-passages']?[]:values.action??Object.keys(PASSAGE_ACTIONS);
if(!items.length || values.item?.some(id=>!items.some(i=>i.id===id)) || providers.some(p=>!contract.providers.includes(p)) || lenses.some(l=>!PHASE_ONE_LENSES.includes(l)) || actions.some(a=>!Object.hasOwn(PASSAGE_ACTIONS,a)) || values['no-passages'] && values.action)throw Error('Invalid provider/item/lens/action filter.');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
const store=await openDocumentStore({indexedDB:new IDBFactory(),name:'phase-one-evaluation'});let browser,world,path,report;
const save=async()=>{if(!report)return;await mkdir(dirname(values.out),{recursive:true});await writeFile(values.out,JSON.stringify(report,null,2)+'\n');};
try{
  browser=await fixtureBrowser({module:'/dist/evaluation.mjs'});
  if(values.fixture)path=new FakePath({wait:async()=>{}});
  else {
    if(values['fake-provider'])world=await isolatedCompanion(resolve(values.companion),resolve(values['fake-provider']));
    path=new SeatlinePath({connectNative:()=>nativePort(world?.installed??resolve(values.companion),world?.origin??`chrome-extension://${contract.development_extension_id}/`,world?.env??process.env),policy:()=>({allowGeminiCloud:values['allow-gemini-cloud']===true})});
  }
  const engine=new AnalysisEngine({store,paths:{seatline:path}}),kind=values.fixture?'scripted':world?'real-broker-stand-ins':'live';
  const extract=async item=>{const sha=createHash('sha256').update(await readFile(item.path)).digest('hex');if(item.sha256 && sha!==item.sha256)throw Error('CORPUS_HASH_MISMATCH');return browser.extract(item);};
  report=await runEvaluation({engine,store,items,providers,lenses,actions,extract,kind,sourceCommit,language:values.language,targets:Object.fromEntries(providers.map(provider=>[provider,{model:values.model??null}])),
    beforeRun:values.fixture?config=>{path.scripts.push({text:phaseOneOutput({lens:config.lens,action:config.action,outputLanguage:config.language},JSON.parse(engine.preview(config).request.document))});}:undefined,
    checkpoint:async value=>{report=value;report.workingTreeDirty=dirty;report.seatlineRevision=contract.revision;await save();}});
  report.expertReview={complete:false,reviewed:0,total:report.runs.length};
  await save();const formPath=values['review-out']??values.out.replace(/\.json$/,'')+'.review.json';await mkdir(dirname(formPath),{recursive:true});await writeFile(formPath,JSON.stringify(reviewForm(report),null,2)+'\n');
  console.log(JSON.stringify({kind,automaticPassed:report.automaticPassed,phaseOneAccepted:false,runs:report.runs.length,report:values.out,reviewForm:formPath}));if(!report.automaticPassed)process.exitCode=1;
}finally{
  if(path){for(const doc of await store.listDocuments())await store.deleteDocument(doc.id);const maintenance=await new MaintenanceDispatcher(store,{seatline:path}).drain();if(report){report.cleanup={pending:(await store.all('maintenance')).length,results:maintenance};if(report.cleanup.pending)process.exitCode=1;await save();}}
  path?.client?.close();store.close();await browser?.close();await world?.close();
}
