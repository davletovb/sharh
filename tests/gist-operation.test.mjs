import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblePrompt} from '../src/analysis/prompts.mjs';
import {GIST_INSTRUCTIONS} from '../src/analysis/lenses.mjs';
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
