import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {exampleDocument} from './helpers/document.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {AnalysisEngine} from '../src/analysis/engine.mjs';
import {FakePath} from '../src/paths/fake.mjs';
import {PHASE_ONE_LENSES} from '../src/analysis/lenses.mjs';
import {TASKS} from '../src/analysis/tasks.mjs';
import {runEvaluation,compareTierRows} from '../src/evaluation/run.mjs';
import {taskChecks} from '../src/evaluation/tasks.mjs';
import {phaseOneOutput} from '../scripts/lib/phase-one-fixtures.mjs';
import {phaseTwoOutput} from '../scripts/lib/phase-two-fixtures.mjs';

const specimen={id:'example',path:'example',format:'html',language:'en',expected:{headings:['Title','Section']}};
async function world(scriptFor){const indexedDB=new IDBFactory(),store=await openDocumentStore({indexedDB}),path=new FakePath({wait:async()=>{},scriptFor});return {store,path,engine:new AnalysisEngine({store,paths:{seatline:path}})};}
const answer=request=>{const task=JSON.parse(request.task.split('\n')[1]),source=JSON.parse(request.document);return (task.action||PHASE_ONE_LENSES.includes(task.lens)?phaseOneOutput:phaseTwoOutput)(task,source);};
const rec=(t,fields)=>({t,...fields}),chk=(part,text='Plain.')=>rec('chk',{part,text,refs:[3]});

test('the task checks hold each instruction to what a machine can count',()=> {
 const good={
  gist:[rec('sum',{level:'line',text:'A short plain line.',refs:[3]}),rec('sum',{level:'abstract',text:'A short plain abstract.',refs:[3]})],
  argument:[chk('claim'),chk('reason'),chk('reason'),chk('strength'),chk('assessment')],
  terms:[rec('term',{src:'a',tr:'b',text:'c',refs:[3]})],
  outline:[rec('sec',{id:'s1',title:'T',role:'context',gist:'g',span:[1,3]})],
  ideas:[1,2,3].map(i=>rec('theme',{id:'t'+i,label:'L'+i,text:'x',refs:[3]})),
  questions:[rec('q',{level:'comprehension',text:'a?',refs:[3]}),rec('q',{level:'analysis',text:'b?',refs:[3]}),rec('q',{level:'debate',text:'c?',refs:[3]})],
  deep:[rec('sum',{level:'brief',text:'A synthesis.',refs:[3]}),rec('sec',{id:'s1',title:'T',role:'context',gist:'g',span:[1,3]}),chk('claim'),chk('reason'),chk('reason'),chk('assessment'),rec('q',{level:'debate',text:'x?',refs:[3]})],
  kind:[],cites:[]
 };
 for(const id of Object.keys(TASKS))assert.deepEqual(taskChecks(id,good[id]),[],id+' passes a well-formed answer');
 const words=n=>Array.from({length:n},()=>'word').join(' ');
 const bad=[
  ['gist',[rec('sum',{level:'line',text:words(26),refs:[3]}),rec('sum',{level:'abstract',text:'Short.',refs:[3]})],'gist:line_over_25_words'],
  ['gist',[rec('sum',{level:'line',text:'Fine.',refs:[3]}),rec('sum',{level:'abstract',text:words(71),refs:[3]})],'gist:abstract_over_70_words'],
  ['gist',[rec('sum',{level:'line',text:'Fine (¶3).',refs:[3]}),rec('sum',{level:'abstract',text:'Short.',refs:[3]})],'gist:gist_paragraph_marks'],
  ['gist',[rec('sum',{level:'line',text:'A.',refs:[3]}),rec('sum',{level:'abstract',text:'B.',refs:[3]}),rec('sum',{level:'section',text:'C.',refs:[3]})],'gist:records_too_many'],
  ['argument',[chk('claim'),chk('assessment')],'argument:reason_too_few'],
  ['argument',[chk('claim'),chk('claim'),chk('reason'),chk('reason'),chk('assessment')],'argument:claim_too_many'],
  ['argument',[chk('claim'),chk('reason'),chk('reason')],'argument:assessment_too_few'],
  ['terms',Array.from({length:9},(_,i)=>rec('term',{src:'s'+i,tr:'t',text:'x',refs:[3]})),'terms:terms_too_many'],
  ['terms',[],'terms:terms_too_few'],
  ['outline',[rec('sec',{id:'a',title:'A',role:'context',gist:'g',span:[1,2]}),rec('sec',{id:'b',parent:'a',title:'B',role:'context',gist:'g',span:[2,3]})],'outline:nested'],
  ['ideas',[1,2].map(i=>rec('theme',{id:'t'+i,label:'L',text:'x',refs:[3]})),'ideas:ideas_too_few'],
  ['ideas',[1,2,3,4,5,6].map(i=>rec('theme',{id:'t'+i,label:'L',text:'x',refs:[3]})),'ideas:ideas_too_many'],
  ['questions',[rec('q',{level:'debate',text:'a?',refs:[3]}),rec('q',{level:'analysis',text:'b?',refs:[3]}),rec('q',{level:'analysis',text:'c?',refs:[3]})],'questions:no_comprehension_question'],
  ['deep',[rec('sum',{level:'abstract',text:'X.',refs:[3]}),chk('claim'),chk('reason'),chk('reason'),chk('assessment'),rec('sec',{id:'s',title:'T',role:'context',gist:'g',span:[1,3]})],'deep:synthesis_not_brief'],
  ['deep',[rec('sum',{level:'brief',text:'X.',refs:[3]}),chk('claim'),chk('reason'),chk('reason'),chk('assessment'),...Array.from({length:4},()=>rec('q',{level:'debate',text:'x?',refs:[3]})),rec('sec',{id:'s',title:'T',role:'context',gist:'g',span:[1,3]})],'deep:questions_too_many']
 ];
 for(const [id,rows,expected] of bad)assert.ok(taskChecks(id,rows).includes(expected),`${id}: ${expected} in ${JSON.stringify(taskChecks(id,rows))}`);
 assert.deepEqual(taskChecks('nothing',[]),[],'an unknown task has no checks');
});

test('the tasks evaluation runs every conversation reading on its declared tier and passes the scripted fixtures',async()=> {
 const w=await world(({request})=>({text:answer(request)})),doc=await exampleDocument();
 try{
  const report=await runEvaluation({...w,items:[specimen],providers:['claude'],lenses:[],actions:[],tasks:Object.keys(TASKS),phase:'tasks',kind:'scripted',sourceCommit:'test',extract:async()=>doc});
  assert.equal(report.runs.length,9);assert.equal(report.matrix.expectedRuns,9);assert.equal(report.matrix.tiers,'declared');
  assert.deepEqual(report.runs.map(r=>[r.task,r.tier,r.passed]),Object.entries(TASKS).map(([id,t])=>[id,t.tier,true]));
  assert.equal(report.automaticPassed,true);assert.equal(report.comparison,undefined);
  // The request really carried the task's tier, operation and budget.
  const calls=w.path.calls.map(c=>({tier:c.request.tier,task:JSON.parse(c.request.task.split('\n')[1])}));
  assert.deepEqual(calls.map(c=>[c.task.lens,c.task.operation??null,c.tier]),Object.values(TASKS).map(t=>[t.lens,t.operation??null,t.tier]));
  assert.deepEqual(calls.filter(c=>TASKS.gist.lens===c.task.lens&&c.task.operation==='gist').map(c=>c.task.maxRecords),[2]);
 }finally{w.store.close();}
});

test('a tier comparison runs a task on both tiers and says where Quick falls short',async()=> {
 const doc=await exampleDocument(),seen=[];
 // Quick answers the gist at length and adds a section record; Analysis answers it as asked.
 const w=await world(({request,target})=>{const task=JSON.parse(request.task.split('\n')[1]);seen.push([task.operation??task.lens,request.tier,target.model]);
  if(task.operation==='gist'&&request.tier==='quick'){const long=Array.from({length:40},()=>'word').join(' ');return {text:[{t:'meta',lens:'summary',lang:'en'},{t:'sum',level:'line',text:long,refs:[3]},{t:'sum',level:'abstract',text:'Short.',refs:[3]},{t:'sum',level:'section',text:'Extra.',refs:[3]},{t:'end'}].map(r=>JSON.stringify(r)+'\n').join('')};}
  return {text:answer(request)};});
 try{
  const report=await runEvaluation({...w,items:[specimen],providers:['claude'],lenses:[],actions:[],tasks:['gist','terms'],compareTiers:true,models:{quick:'haiku',analysis:'opus'},phase:'tasks',kind:'scripted',sourceCommit:'test',extract:async()=>doc});
  assert.equal(report.runs.length,4);assert.deepEqual(report.matrix.tiers,['quick','analysis']);assert.deepEqual(report.matrix.models,{quick:'haiku',analysis:'opus'});
  assert.deepEqual(seen.sort(),[['gist','analysis','opus'],['gist','quick','haiku'],['learn','analysis','opus'],['learn','quick','haiku']].sort());
  const byTask=Object.fromEntries(report.comparison.map(c=>[c.task,c]));
  assert.equal(byTask.gist.verdict,'quick_falls_short');assert.equal(byTask.gist.declared,'analysis');assert.equal(byTask.gist.analysis.passed,true);assert.equal(byTask.gist.quick.passed,false);
  assert.ok(byTask.gist.quick.missing.includes('gist:line_over_25_words'));assert.ok(byTask.gist.quick.missing.includes('gist:records_too_many'));
  assert.equal(byTask.terms.verdict,'both_pass');assert.equal(report.automaticPassed,false,'a failing tier fails the report');
  assert.equal(compareTierRows([]).length,0);
 }finally{w.store.close();}
});

test('the evaluation refuses a tasks matrix it cannot run',async()=> {
 const w=await world(({request})=>({text:answer(request)})),doc=await exampleDocument(),base={...w,items:[specimen],providers:['claude'],kind:'scripted',sourceCommit:'test',extract:async()=>doc};
 try{
  for(const bad of [{phase:'tasks',lenses:[],actions:[],tasks:[]},{phase:'tasks',lenses:[],actions:[],tasks:['nothing']},{phase:'tasks',lenses:[],actions:[],tasks:['gist','gist']},{phase:'tasks',lenses:['summary'],actions:[],tasks:['gist']},{phase:'tasks',lenses:[],actions:[],tasks:['gist'],models:{fast:'x'}},{phase:'one',lenses:['summary'],actions:[],tasks:['gist']},{phase:'one',lenses:['summary'],actions:[],compareTiers:true}])
   await assert.rejects(runEvaluation({...base,...bad}),/INVALID_EVALUATION_MATRIX/);
 }finally{w.store.close();}
});
