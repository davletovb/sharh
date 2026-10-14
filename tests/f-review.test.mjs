import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {IDBFactory} from 'fake-indexeddb';
import {exampleDocument} from './helpers/document.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {assemblePrompt,promptIdentity,RULES,PROMPT_VERSION} from '../src/analysis/prompts.mjs';
import {turnFor} from '../src/paths/seatline.mjs';
import {LENSES} from '../src/analysis/contract.mjs';
import {runEvaluation,evaluationScope} from '../src/evaluation/run.mjs';
import {measureOutput,metricsPass,languageCompatible} from '../src/evaluation/metrics.mjs';
import {reviewForm,REVIEW_DIMENSIONS} from '../src/evaluation/reviews.mjs';
import {phaseOneOutput} from '../scripts/lib/phase-one-fixtures.mjs';
import {standInOutput} from '../scripts/lib/draft-prompts.mjs';
import {cleanupEvaluation,protectInputs,evaluationFiles} from '../scripts/lib/evaluation-lifecycle.mjs';
const lines=(...records)=>records.map(r=>JSON.stringify(r)+'\n').join(''),end={t:'end'};
const logic=(refs=[3],extra={})=>[{t:'node',id:'n1',kind:'claim',text:'Reconstructed argument',refs,basis:'inferred',...extra},{t:'step',n:1,text:'An inferred step',refs}];
const specimen={id:'example',path:'example',format:'html',language:'en',expected:{headings:['Title','Section']}};
const answer=request=>phaseOneOutput(JSON.parse(request.task.split('\n')[1]),JSON.parse(request.document));
async function world(path=new FakePath({wait:async()=>{}})){const indexedDB=new IDBFactory(),store=await openDocumentStore({indexedDB});return {indexedDB,store,path,engine:new AnalysisEngine({store,paths:{seatline:path}})};}

test('stand-in CLIs retain the legacy fallback for non-Phase-1 lenses, including actionless passage',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc);
  for(const provider of ['claude','codex'])for(const lens of Object.keys(LENSES).filter(l=>!['summary','structure','logic','thinking'].includes(l))){
    const request=assemblePrompt(doc,scope,{lens}).request,text=turnFor({provider},request).messages[0].text,input=provider==='claude'?JSON.stringify({message:{content:[{text}]}}):text;
    const events=execFileSync(process.execPath,['scripts/lib/stand-in-cli.mjs',provider],{input,encoding:'utf8'}).trim().split('\n').map(JSON.parse);
    const output=provider==='claude'?events.find(e=>e.type==='result').result:events.find(e=>e.type==='item.completed').item.text;
    assert.equal(output,standInOutput(lens,JSON.parse(request.document)));
  }
});

test('fixture answers are allocated lazily, so oversized preflight cells cannot shift later lens output',async()=>{
  let generated=0;const path=new FakePath({wait:async()=>{},scriptFor:({request})=>{generated++;return {text:answer(request)};}}),w=await world(path),small=await exampleDocument(),large=structuredClone(small);
  large.blocks[2].text='x'.repeat(1010000);large.blocks[2].anchor.quote.exact=large.blocks[2].text;large.blocks[2].anchor.position.end=large.blocks[2].anchor.position.start+large.blocks[2].text.length;
  try{const report=await runEvaluation({...w,items:[{...specimen,id:'large',path:'large'},specimen],providers:['claude'],lenses:['summary','thinking'],actions:[],kind:'scripted',sourceCommit:'test',extract:async i=>i.id==='large'?large:small});
    assert.equal(report.runs.length,4);assert.ok(report.runs.slice(0,2).every(r=>r.failure.code==='TOO_LARGE'));assert.ok(report.runs.slice(2).every(r=>r.passed));assert.equal(generated,2);assert.equal(path.calls.length,2);assert.equal(path.scripts.length,0);
  }finally{w.store.close();}
});

test('review-only defaults preserve the generated report, skip building and reject direct or aliased input overwrites',async()=>{
  const report={id:'report',sourceCommit:'source',promptVersion:PROMPT_VERSION,automaticPassed:true,runs:[{id:'run',item:'example',provider:'claude',lens:'logic',action:null}]},form=reviewForm(report);
  Object.assign(form.runs[0],{reviewer:'Owner',reviewedAt:'2026-10-15T01:00:00+05:00',disposition:'accepted',ratings:Object.fromEntries(REVIEW_DIMENSIONS.map(k=>[k,4]))});
  const dir=await mkdtemp(join(tmpdir(),'sharh-f-review-inputs-')),marker=resolve('dist','review-marker-'+crypto.randomUUID());
  try{const input=join(dir,'report.json'),reviews=join(dir,'form.json'),original=JSON.stringify(report);await writeFile(input,original);await writeFile(reviews,JSON.stringify(form));await mkdir('dist',{recursive:true});await writeFile(marker,'review must not build');
    const output=execFileSync('npm',['run','evaluate','--','--report',input,'--reviews',reviews],{encoding:'utf8',timeout:15000});assert.doesNotMatch(output,/> sharh.* build/);assert.equal(await readFile(marker,'utf8'),'review must not build');assert.equal(await readFile(input,'utf8'),original);
    assert.equal(JSON.parse(await readFile(join(dir,'report.reviewed.json'))).expertReview.complete,true);
    for(const out of [input,reviews])assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-phase-one.mjs','--report',input,'--reviews',reviews,'--out',out],{stdio:'pipe'}));
    for(const [name,create]of [['symlink.json',symlink],['hardlink.json',link]]){const alias=join(dir,name);await create(input,alias);await assert.rejects(protectInputs([alias],[input]),/OVERWRITES_INPUT/);}
    await assert.rejects(protectInputs([join(dir,'same.json'),join(dir,'same.json')]),/OVERWRITES_INPUT/);assert.notEqual(evaluationFiles({report:input}).out,input);
  }finally{await rm(marker,{force:true});await rm(dir,{recursive:true,force:true});}
});

test('cleanup without a constructed path still deletes documents and records pending maintenance while closing resources',async()=>{
  const w=await world(),doc=await exampleDocument();await w.store.saveDocument(doc);await w.store.put('runs',{id:'allocated',docId:doc.id,extractionVersion:doc.version,target:{path:'seatline',provider:'claude'},cleanupGroup:'eval-early-setup'});const closed=[];
  const cleanup=await cleanupEvaluation({store:w.store,browser:{close(){closed.push('browser');}},world:{close(){closed.push('world');}}});assert.equal(cleanup.completed,false);assert.equal(cleanup.pending,1);assert.deepEqual(closed,['browser','world']);assert.equal(cleanup.results[0].code,'PATH_UNAVAILABLE');
  const again=await openDocumentStore({indexedDB:w.indexedDB});try{assert.equal(await again.getDocument(doc.id),null);assert.equal((await again.all('maintenance')).length,1);}finally{again.close();}
});

test('cleanup failures cannot skip later teardown and are serializable in a failed cleanup report',async()=>{
  const w=await world(),doc=await exampleDocument();await w.store.saveDocument(doc);await w.store.put('runs',{id:'allocated',docId:doc.id,target:{path:'seatline',provider:'claude'},cleanupGroup:'eval-close-failures'});const order=[],close=w.store.close.bind(w.store);w.store.close=()=>{order.push('store');close();};
  const cleanup=await cleanupEvaluation({store:w.store,path:{cleanup(){throw Error('DRAIN_FAILED');},client:{close(){order.push('path');throw Error('PATH_CLOSE_FAILED');}}},browser:{close(){order.push('browser');throw Error('BROWSER_CLOSE_FAILED');}},world:{close(){order.push('world');}}});
  assert.equal(cleanup.completed,false);assert.equal(cleanup.pending,1);assert.equal(cleanup.results[0].status,'pending');assert.deepEqual(order,['path','store','browser','world']);assert.deepEqual(cleanup.errors.map(e=>e.stage),['path-close','browser-close']);assert.ok(JSON.stringify(cleanup).includes('BROWSER_CLOSE_FAILED'));
  const setup=await cleanupEvaluation({world:{close(){throw Error('SETUP_WORLD_CLOSE_FAILED');}}});assert.equal(setup.pending,0);assert.equal(setup.completed,false);assert.equal(setup.errors[0].stage,'world-close');
});

test('a real CLI browser-setup failure writes a failed report and still closes its store and server',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sharh-f-setup-failure-')),out=join(dir,'failed.json');
  try{assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-phase-one.mjs','--fixture','--item','article-en','--lens','logic','--no-passages','--out',out],{env:{...process.env,SHARH_CHROME_EXECUTABLE:join(dir,'missing-chromium')},stdio:'pipe',timeout:20000}),error=>error.status===1);
    const report=JSON.parse(await readFile(out));assert.equal(report.automaticPassed,false);assert.equal(report.liveProviderClaim,false);assert.equal(report.runs.length,0);assert.ok(report.failure.reason.includes('missing-chromium'));assert.equal(report.cleanup.completed,true);assert.equal(report.cleanup.pending,0);assert.deepEqual(report.cleanup.errors,[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('metadata defaults to English and tolerates a missing script subtag while rejecting explicit language/script/lens conflicts',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc),good=lines({t:'meta',lens:'logic',lang:'en'},...logic(),end),args={doc,scope,lens:'logic'};
  assert.equal(metricsPass(measureOutput(good,args)),true);assert.equal(metricsPass(measureOutput(good.replace('"lens":"logic"','"lens":"summary"'),args)),false);
  assert.equal(metricsPass(measureOutput(good.replace('"lang":"en"','"lang":"uz"'),{...args,language:'uz-Latn'})),true);assert.equal(languageCompatible('uz-Cyrl','uz-Latn'),false);assert.equal(languageCompatible('en-CA','en-US'),false);assert.equal(languageCompatible('uz-Latn','UZ-latn'),true);assert.equal(languageCompatible('en','ar'),false);
  const w=await world(new FakePath({wait:async()=>{},scriptFor:({request})=>({text:answer(request)})}));try{const {language,...item}=specimen,report=await runEvaluation({...w,items:[item],providers:['claude'],lenses:['summary'],actions:[],kind:'scripted',sourceCommit:'test',extract:async()=>doc});assert.equal(report.runs[0].language,'en');assert.equal(report.runs[0].passed,true);}finally{w.store.close();}
});

test('every passage action needs a selected-paragraph reference; grounded context may still supplement it',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc,{kind:'selection',spans:[{n:5,start:0,end:8}]});
  for(const action of ['Explain','Translate','Logic','Define']){
    const lens=action==='Logic'?'logic':'passage',records=action==='Logic'?logic([3]):[{t:'note',text:'Context only',refs:[3]},...(['Translate','Define'].includes(action)?[{t:'term',src:'Selected',tr:'Selected',text:'A definition',refs:[3]}]:[])],args={doc,scope,lens,action};
    const context=measureOutput(lines(...records,end),args);assert.equal(context.referenceValidity,1);assert.equal(context.selectedReferences,0);assert.equal(metricsPass(context),false);
    const grounded=structuredClone(records);grounded[0].refs=[3,5];assert.equal(metricsPass(measureOutput(lines(...grounded,end),args)),true);
  }
});

test('valid inferred-only and unquoted stated Logic passes, while every supplied quote must verify',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc),args={doc,scope,lens:'logic'};
  for(const node of [{},{basis:'stated'},{quote:doc.blocks[2].text}]){const metrics=measureOutput(lines(...logic([3],node),end),args);assert.equal(metricsPass(metrics),true);}
  assert.equal(metricsPass(measureOutput(lines(...logic([3],{basis:'stated',quote:'Invented quotation'}),end),args)),false);
});

test('raw finding budgets exclude meta/end and reject extra findings without hiding useful records',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc),output=lines({t:'meta',lens:'logic',lang:'en'},...logic(),end),args={doc,scope,lens:'logic'};
  const within=measureOutput(output,{...args,budget:2});assert.equal(within.findingRecords,2);assert.equal(within.lines,4);assert.equal(metricsPass(within),true);
  const extra=measureOutput(output,{...args,budget:1});assert.equal(extra.overBudget,true);assert.equal(metricsPass(extra),false);assert.equal(extra.findingRecords,2);
});

test('prompt identity changes with rules, lens wording or contract even without another version bump',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc),prompt=assemblePrompt(doc,scope,{lens:'logic'}),key=promptIdentity(scope,prompt.config);assert.equal(key,prompt.promptKey);
  assert.notEqual(key,promptIdentity(scope,prompt.config,{rules:RULES+' A wording change.'}));assert.notEqual(key,promptIdentity(scope,prompt.config,{instructions:'Different lens instructions.'}));assert.notEqual(key,promptIdentity(scope,prompt.config,{contract:'Changed contract.'}));
  const w=await world(new FakePath({scripts:[{text:lines(...logic()),truncated:true}],wait:async()=>{}}));await w.store.saveDocument(doc);
  try{const first=await w.engine.start({doc,scope,target:{path:'seatline',provider:'claude'},lens:'logic'});await w.engine.repository.write(first.run.id,{promptVersion:'analysis-2'});await assert.rejects(w.engine.continue(first.run.id),/PROMPT_VERSION_CHANGED/);assert.equal(w.path.calls.length,1);}finally{w.store.close();}
});

test('selection offsets are UTF-16 units across astral letters, emoji and combining text',async()=>{
  const doc=await exampleDocument(),text='😀 𐐀𐐁𐐂𐐃 العربية Oʻqish e\u0301 '+('😀'.repeat(170));doc.blocks[2].text=text;
  const define=evaluationScope(doc,'Define'),block=define.blocks.find(b=>b.selected),span=block.selected[0];assert.equal(span.start,3);assert.equal(span.end,11);assert.equal(text.slice(span.start,span.end),'𐐀𐐁𐐂𐐃');
  const translated=evaluationScope(doc,'Translate'),selection=translated.blocks.find(b=>b.selected).selected[0],expected=[...text].slice(0,160).join('');assert.equal(selection.end,expected.length);assert.equal(text.slice(selection.start,selection.end),expected);assert.equal(expected.isWellFormed(),true);
  const combining=text.indexOf('e\u0301'),direct=buildScope(doc,{kind:'selection',spans:[{n:3,start:combining,end:combining+2}]});assert.equal(direct.blocks.find(b=>b.selected).text.slice(combining,combining+2),'e\u0301');
});

test('Structure coverage counts original heading titles at the right starts, including duplicates',async()=>{
  const doc=await exampleDocument(),scope=buildScope(doc),output=phaseOneOutput({lens:'structure',outputLanguage:'en'},JSON.parse(assemblePrompt(doc,scope,{lens:'structure'}).request.document)),args={doc,scope,lens:'structure',expectedHeadings:['Title','Section']};
  assert.equal(measureOutput(output,args).headingCoverage,1);const renamed=output.replace('"title":"Title"','"title":"Invented heading"').replace('"title":"Section"','"title":"Another heading"');assert.equal(measureOutput(renamed,args).headingCoverage,0);assert.equal(metricsPass(measureOutput(renamed,args)),false);
});

test('late deltas without attempt metadata cannot contaminate the authoritative first/repair outputs',async()=>{
  const original='not json\nnot json\n'+lines(end),w=await world(),doc=await exampleDocument(),start=w.engine.start.bind(w.engine);let repaired;
  w.engine.start=async(config,options)=>{const result=await start(config,options);options.onEvent?.({type:'delta',text:repaired});return result;};
  try{const report=await runEvaluation({...w,items:[specimen],providers:['claude'],lenses:['logic'],actions:[],kind:'scripted',sourceCommit:'test',extract:async()=>doc,beforeRun:config=>{repaired=answer(assemblePrompt(config.doc,config.scope,config).request);w.path.scripts.push({text:original},{text:repaired});}});
    assert.equal(report.runs[0].rawAttempts[0],original);assert.equal(report.runs[0].rawAttempts[1],repaired);assert.equal(report.runs[0].metrics.parseRate,1/3);assert.equal(report.automaticPassed,false);
  }finally{w.store.close();}
});
