import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblePrompt} from '../src/analysis/prompts.mjs';
import {PASSAGE_ACTIONS,OFFERED_ACTIONS,passageLens,GIST_INSTRUCTIONS,LEARN_INSTRUCTIONS,OUTLINE_INSTRUCTIONS,QUIZ_INSTRUCTIONS,LENS_INSTRUCTIONS} from '../src/analysis/lenses.mjs';
import {TASKS,TASK_TIERS,taskRun} from '../src/analysis/tasks.mjs';
import {LENSES} from '../src/analysis/contract.mjs';
import {RecordParser} from '../src/analysis/parser.mjs';
import {markdown} from '../src/toolkit/exports.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {exampleDocument} from './helpers/document.mjs';

test('the gist asks for a one-line point and a short abstract, and only on the Summary lens',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),plain=assemblePrompt(doc,scope,{lens:'summary'}),gist=assemblePrompt(doc,scope,{lens:'summary',operation:'gist',budget:2});
 const taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]),task=taskOf(gist);
 assert.equal(task.instructions,GIST_INSTRUCTIONS);assert.equal(task.operation,'gist');assert.equal(task.maxRecords,2);
 assert.match(task.instructions,/exactly two sum records/);assert.match(task.instructions,/at most 25 words/);assert.match(task.instructions,/no paragraph numbers/);
 assert.equal(gist.request.kind,'analysis');assert.notEqual(gist.promptKey,plain.promptKey);assert.equal(gist.promptVersion,plain.promptVersion);
 assert.notEqual(taskOf(plain).instructions,GIST_INSTRUCTIONS,'the Summary lens keeps its own instructions');
 for(const lens of ['logic','structure','thinking'])assert.throws(()=>assemblePrompt(doc,scope,{lens,operation:'gist'}),/INVALID_TASK/);
});

test('learn the terms asks for at most eight ranked terms, only on the Terms lens',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 const learn=assemblePrompt(doc,scope,{lens:'terms',operation:'learn',budget:8}),plain=assemblePrompt(doc,scope,{lens:'terms'}),task=taskOf(learn);
 assert.equal(task.instructions,LEARN_INSTRUCTIONS);assert.equal(task.operation,'learn');assert.equal(task.maxRecords,8);
 assert.match(task.instructions,/at most eight/);assert.match(task.instructions,/most useful first/);assert.match(task.instructions,/Skip ordinary words/);
 assert.notEqual(taskOf(plain).instructions,LEARN_INSTRUCTIONS,'the Terms lens keeps its own instructions');assert.notEqual(learn.promptKey,plain.promptKey);
 for(const lens of ['summary','logic','questions'])assert.throws(()=>assemblePrompt(doc,scope,{lens,operation:'learn'}),/INVALID_TASK/);
});

const row=(part,text='A plain sentence.',extra={})=>JSON.stringify({t:'chk',part,text,refs:[3],basis:'inferred',...extra})+'\n';

test('the argument check is its own lens with its own record, instruction and limits',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 const prompt=assemblePrompt(doc,scope,{lens:'check',budget:10}),task=taskOf(prompt);
 assert.equal(task.instructions,LENS_INSTRUCTIONS.check);assert.equal(task.maxRecords,10);
 for(const phrase of [/one claim/,/two or three reason/,/only when the text shows one/,/relevance and strength of the evidence/,/whether the conclusion follows/,/plausible alternatives/,/not a check of the facts/,/do not give a score/,/never invent a flaw/])assert.match(task.instructions,phrase);
 const contract=JSON.parse(prompt.request.task.split('\n')[3]);
 assert.deepEqual(Object.keys(contract.types),['meta','chk','end']);
 assert.deepEqual(contract.types.chk.part.values,['claim','reason','strength','weakness','assumption','objection','assessment']);
 assert.deepEqual(Object.keys(contract.types.chk),['t','part','text','refs','basis']);
 // The Logic and Critique lenses are untouched, so Studio keeps them.
 assert.notEqual(LENS_INSTRUCTIONS.logic,LENS_INSTRUCTIONS.check);assert.ok(LENS_INSTRUCTIONS.critique);
 const entries=[],parser=new RecordParser({lens:'check',blocks:scope.blocks,onRecord:e=>entries.push(e)});
 parser.push(['claim','claim','reason','reason','reason','reason','strength','weakness','weakness','assumption','assumption','assumption','objection','objection','assessment','assessment'].map(part=>row(part)).join('')+JSON.stringify({t:'note',text:'Not allowed here.'})+'\n'+JSON.stringify({t:'chk',part:'verdict',text:'Unknown part.',refs:[3]})+'\n');
 parser.finish();
 const count=part=>entries.filter(e=>e.record.part===part).length;
 assert.deepEqual(Object.fromEntries(['claim','reason','strength','weakness','assumption','objection','assessment'].map(p=>[p,count(p)])),{claim:1,reason:3,strength:1,weakness:1,assumption:2,objection:1,assessment:1});
 assert.equal(entries.length,10);assert.equal(parser.metrics.dropped.limit,6);assert.ok(parser.metrics.dropped.type,'a note is not an argument-check record');assert.ok(parser.metrics.dropped.enum,'an unknown part is refused');
 // References outside the scope are removed, and an optional basis may be left out.
 const lone=[],p2=new RecordParser({lens:'check',blocks:scope.blocks,onRecord:e=>lone.push(e)});p2.push(JSON.stringify({t:'chk',part:'claim',text:'A claim.',refs:[3,999]})+'\n');p2.finish();
 assert.deepEqual(lone[0].record,{t:'chk',part:'claim',text:'A claim.',refs:[3]});
});

test('an argument check exports with plain part names',async()=> {
 const doc=await exampleDocument(),saved={run:{lens:'check',version:1,config:{}},records:[{record:{t:'chk',part:'claim',text:'The claim.',refs:[3]}},{record:{t:'chk',part:'assessment',text:'Established so far.',refs:[3]}}]};
 const text=markdown(saved,doc);assert.match(text,/## Main claim/);assert.match(text,/## What the text establishes/);assert.doesNotMatch(text,/## chk/);
});

test('the outline is a Structure operation and Main ideas is a lens of theme records, at most five',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 const outline=assemblePrompt(doc,scope,{lens:'structure',operation:'outline',budget:12}),plain=assemblePrompt(doc,scope,{lens:'structure'});
 assert.equal(taskOf(outline).instructions,OUTLINE_INSTRUCTIONS);assert.equal(taskOf(outline).maxRecords,12);assert.notEqual(outline.promptKey,plain.promptKey);
 for(const phrase of [/at most twelve and never nested/,/Cover the whole scope without gaps or overlaps/,/no headings, infer a few sections/])assert.match(OUTLINE_INSTRUCTIONS,phrase);
 assert.equal(taskOf(plain).instructions,LENS_INSTRUCTIONS.structure,'Structure keeps its own instructions');
 for(const lens of ['summary','logic','terms'])assert.throws(()=>assemblePrompt(doc,scope,{lens,operation:'outline'}),/INVALID_TASK/);
 const ideas=assemblePrompt(doc,scope,{lens:'ideas',budget:5}),contract=JSON.parse(ideas.request.task.split('\n')[3]);
 assert.equal(taskOf(ideas).instructions,LENS_INSTRUCTIONS.ideas);assert.deepEqual(Object.keys(contract.types),['meta','theme','end']);assert.notEqual(LENS_INSTRUCTIONS.ideas,LENS_INSTRUCTIONS.themes,'Themes keeps its codebook');
 const entries=[],parser=new RecordParser({lens:'ideas',blocks:scope.blocks,onRecord:e=>entries.push(e)}),theme=i=>JSON.stringify({t:'theme',id:'t'+i,label:'Idea '+i,text:'Why it matters.',refs:[3]})+'\n';
 parser.push(Array.from({length:7},(_,i)=>theme(i)).join('')+JSON.stringify({t:'code',id:'c',theme:'t0',label:'x',text:'x'})+'\n');parser.finish();
 assert.equal(entries.length,5);assert.equal(parser.metrics.dropped.limit,2);assert.ok(parser.metrics.dropped.type,'a code is not a Main ideas record');
});

test('the questions ask for three to five, with no answers, and only on the Questions lens',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 const quiz=assemblePrompt(doc,scope,{lens:'questions',operation:'quiz',budget:5}),plain=assemblePrompt(doc,scope,{lens:'questions'}),task=taskOf(quiz);
 assert.equal(task.instructions,QUIZ_INSTRUCTIONS);assert.equal(task.maxRecords,5);assert.notEqual(quiz.promptKey,plain.promptKey);
 for(const phrase of [/three to five questions/,/at least one question that tests what the text says/,/do not force every level/,/no answers and no hints/])assert.match(task.instructions,phrase);
 assert.equal(taskOf(plain).instructions,LENS_INSTRUCTIONS.questions,'the Questions lens keeps its own instructions');
 for(const lens of ['summary','terms','check'])assert.throws(()=>assemblePrompt(doc,scope,{lens,operation:'quiz'}),/INVALID_TASK/);
});

test('the deep reading is one lens with a synthesis, an outline, an argument check and open questions, within limits',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 const prompt=assemblePrompt(doc,scope,{lens:'deep',budget:22}),task=taskOf(prompt),contract=JSON.parse(prompt.request.task.split('\n')[3]);
 assert.equal(task.instructions,LENS_INSTRUCTIONS.deep);assert.equal(task.maxRecords,22);assert.deepEqual(Object.keys(contract.types),['meta','sum','sec','chk','q','end']);
 for(const phrase of [/in one pass/,/at most 120 words/,/at most eight and never nested/,/one claim, two or three reason/,/at most two assumption records/,/at most three q records/,/do not repeat the main claim in every part/,/not a check of the facts/,/do not give a score/])assert.match(task.instructions,phrase);
 assert.ok(['structure','logic','thinking','critique'].every(lens=>LENS_INSTRUCTIONS[lens]),'the three-lens deep read and Critique stay available for Studio');
 const entries=[],parser=new RecordParser({lens:'deep',blocks:scope.blocks,onRecord:e=>entries.push(e)}),line=r=>JSON.stringify({refs:[3],...r})+'\n';
 const sec=i=>line({t:'sec',id:'s'+i,title:'Part '+i,role:'context',gist:'It does something.',span:[1,2]});
 parser.push(line({t:'sum',level:'brief',text:'The synthesis.'})+line({t:'sum',level:'brief',text:'A second synthesis.'})+line({t:'sum',level:'abstract',text:'The wrong level.'})
  +Array.from({length:10},(_,i)=>sec(i)).join('')+line({t:'chk',part:'claim',text:'The claim.'})+line({t:'chk',part:'claim',text:'A second claim.'})
  +['reason','reason','reason','reason','assessment'].map(part=>line({t:'chk',part,text:'Plain.'})).join('')+Array.from({length:5},(_,i)=>line({t:'q',level:'debate',text:'Question '+i})).join(''));
 parser.finish();
 const count=(t,part)=>entries.filter(e=>e.record.t===t&&(part===undefined||e.record.part===part)).length;
 assert.deepEqual([count('sum'),count('sec'),count('chk','claim'),count('chk','reason'),count('chk','assessment'),count('q')],[1,8,1,3,1,3]);
 assert.equal(parser.metrics.dropped.limit,1+2+1+1+2,'one extra synthesis, two outline sections, one claim, one reason, two questions');assert.ok(parser.metrics.dropped.enum,'only a brief synthesis is accepted');
});

test('Argument on a selection is a short check of those lines, and the old Logic action still works for saved runs',async()=> {
 const doc=await exampleDocument(),selected=buildScope(doc,{kind:'selection',spans:[{n:5,start:0,end:8}]}),taskOf=prompt=>JSON.parse(prompt.request.task.split('\n')[1]);
 assert.deepEqual([...OFFERED_ACTIONS],['Explain','Translate','Argument','Define']);assert.ok(PASSAGE_ACTIONS.Logic,'Logic stays in the table so a saved Logic run can be retried');
 assert.deepEqual(OFFERED_ACTIONS.map(passageLens),['passage','passage','check','passage']);assert.equal(passageLens('Logic'),'logic');
 const prompt=assemblePrompt(doc,selected,{lens:'check',action:'Argument',budget:4}),task=taskOf(prompt),contract=JSON.parse(prompt.request.task.split('\n')[3]);
 assert.equal(task.instructions,PASSAGE_ACTIONS.Argument);assert.equal(task.action,'Argument');assert.equal(task.maxRecords,4);assert.deepEqual(Object.keys(contract.types),['meta','chk','end']);
 for(const phrase of [/what the selected lines do/,/one claim/,/one or two reason records/,/only when the text supports a local weakness/,/Do not summarize the whole text/,/never invent a flaw/])assert.match(task.instructions,phrase);
 assert.throws(()=>assemblePrompt(doc,selected,{lens:'passage',action:'Argument'}),/INVALID_PASSAGE_ACTION/);assert.throws(()=>assemblePrompt(doc,selected,{lens:'check',action:'Explain'}),/INVALID_PASSAGE_ACTION/);
 assert.ok(assemblePrompt(doc,selected,{lens:'logic',action:'Logic'}),'an older Logic run can still be assembled');
 // Only a claim, up to two connections and a weakness are kept.
 const entries=[],parser=new RecordParser({lens:'check',action:'Argument',blocks:selected.blocks,onRecord:e=>entries.push(e)}),line=(part,extra={})=>JSON.stringify({t:'chk',part,text:'Plain.',refs:[5],basis:'inferred',...extra})+'\n';
 parser.push(['claim','claim','reason','reason','reason','weakness','weakness','strength','assessment','assumption','objection'].map(part=>line(part)).join(''));parser.finish();
 assert.deepEqual(entries.map(e=>e.record.part),['claim','reason','reason','weakness']);assert.equal(parser.metrics.dropped.limit,7);
 // The same parser without the action keeps the full argument check.
 const whole=[],other=new RecordParser({lens:'check',blocks:selected.blocks,onRecord:e=>whole.push(e)});other.push(['claim','strength','assessment'].map(part=>line(part)).join(''));other.finish();assert.equal(whole.length,3);
});

test('every conversation task is a real lens or operation with a budget and a tier, and the table says which runs on Quick',async()=> {
 const doc=await exampleDocument(),scope=buildScope(doc);
 assert.deepEqual(Object.keys(TASKS),['gist','argument','terms','deep','outline','ideas','kind','cites','questions']);
 assert.deepEqual(Object.fromEntries(Object.entries(TASKS).map(([id,t])=>[id,t.tier])),{gist:'analysis',argument:'analysis',terms:'quick',deep:'analysis',outline:'quick',ideas:'analysis',kind:'quick',cites:'quick',questions:'quick'});
 for(const [id,task] of Object.entries(TASKS)){
  assert.ok(Object.hasOwn(LENSES,task.lens),id+' names a lens');assert.ok(TASK_TIERS.includes(task.tier),id+' has a tier');assert.ok(task.label);
  const run=taskRun(id);assert.equal(run.lens,task.lens);assert.equal(run.useTier,task.tier);assert.equal(run.operation,task.operation);assert.equal(run.budget,task.budget);
  const prompt=assemblePrompt(doc,scope,{lens:run.lens,operation:run.operation??null,...(run.budget?{budget:run.budget}:{})});
  assert.equal(JSON.parse(prompt.request.task.split('\n')[1]).lens,task.lens,id+' assembles into a prompt');
 }
 assert.throws(()=>taskRun('nothing'),/UNKNOWN_TASK/);assert.ok(Object.values(TASKS).every(t=>t.budget===undefined||t.budget>=1&&t.budget<=200));
});
