// Workflow/transport verification with explicitly synthetic providers; never Phase 3 acceptance.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {IDBFactory} from 'fake-indexeddb';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {SeatlinePath} from '../src/paths/seatline.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {BookJobs} from '../src/across/books.mjs';
import {Library} from '../src/across/library.mjs';
import {AcrossTexts} from '../src/across/synthesis.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {exampleDocument} from '../tests/helpers/document.mjs';
import {phaseThreeOutput} from './lib/phase-three-fixtures.mjs';
import {nativePort} from './lib/native-stdio.mjs';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {cleanupEvaluation,writeEvaluationJSON} from './lib/evaluation-lifecycle.mjs';
const {values}=parseArgs({options:{fixture:{type:'boolean'},companion:{type:'string'},'fake-provider':{type:'string'},out:{type:'string'}}});
if(!!values.fixture===!!values.companion||values.companion&&!values['fake-provider'])throw Error('Use --fixture OR --companion PATH --fake-provider PATH');
const out=values.out??(values.fixture?'test-results/h-workflows.json':'test-results/h-broker-workflows.json'),report={schemaVersion:1,kind:values.fixture?'scripted':'real-broker-stand-ins',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),liveProviderClaim:false,phaseThreeAccepted:false,automaticPassed:false,runs:[]};
let store,path,world;
try{
 store=await openDocumentStore({indexedDB:new IDBFactory(),name:'h-workflow-evaluation'});
 if(values.fixture)path=new FakePath({wait:async()=>{},scriptFor:({request})=>({text:phaseThreeOutput(JSON.parse(request.task.split('\n')[1]),JSON.parse(request.document))})});
 else{world=await isolatedCompanion(resolve(values.companion),resolve(values['fake-provider']));path=new SeatlinePath({connectNative:()=>nativePort(world.installed,world.origin,world.env),policy:()=>({allowGeminiCloud:false})});}
 const engine=new AnalysisEngine({store,paths:{seatline:path}}),books=new BookJobs(engine),library=new Library(store),across=new AcrossTexts(engine),record=saved=>{assert.equal(saved.run.status,'completed');assert.equal(saved.run.metrics.validRate,1);assert.equal(saved.run.metrics.referencesRemoved,0);assert.equal(saved.run.metrics.quotationsFailed,0);report.runs.push({id:saved.run.id,lens:saved.run.lens,target:saved.run.target,metrics:saved.run.metrics,records:saved.records.length});};
 for(const provider of ['claude','codex'])for(const language of ['en','ru','uz-Latn','uz-Cyrl','tr','ar']){
  const target={path:'seatline',provider},documents=await Promise.all([0,1].map(async i=>{const doc=await exampleDocument(`https://example.org/h/${provider}/${language}/${i}`);doc.chapterLevel=2;await store.saveDocument(doc);return doc;})),items=[];
  for(const doc of documents){const config={doc,scope:buildScope(doc),target,language,budget:24},job=await books.create(config);await books.run(job.id);const digests=await books.digests(job.id);for(const c of digests.chapters)record(await engine.repository.get(c.runId));items.push(await library.save(doc));}
  const collection=await library.create(`${provider} / ${language}`);for(const item of items)await library.add(collection.id,item.id);
  const job=(await books.list(documents[0].id))[0];for(const lens of ['summary','structure','logic','thinking'])record(await books.synthesize(job.id,{target,language,lens,budget:24}));
  for(const kind of ['literature-review','meta-synthesis','compare']){const doc=await across.prepare(items,{kind,collectionId:collection.id,target,language,budget:24});record(await across.run(doc,{target,language,budget:24}));}
 }
 assert.equal(report.runs.length,132);report.automaticPassed=true;
}catch(error){report.failure={code:error.code??'H_WORKFLOW_FAILED',message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.cleanup=await cleanupEvaluation({store,path,world});if(!report.cleanup.completed)process.exitCode=1;await writeEvaluationJSON(out,report);}
console.log(JSON.stringify({kind:report.kind,automaticPassed:report.automaticPassed,phaseThreeAccepted:false,runs:report.runs.length,cleanup:{completed:report.cleanup.completed,pending:report.cleanup.pending,errors:report.cleanup.errors},report:out,failure:report.failure?.message}));
