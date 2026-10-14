import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {assemblePrompt,continuationTask} from '../src/analysis/prompts.mjs';
import {turnFor} from '../src/paths/seatline.mjs';
import {RecordParser} from '../src/analysis/parser.mjs';
import {buildScope} from '../src/documents/scopes.mjs';
import {exampleDocument} from './helpers/document.mjs';
test('provider CLI stand-ins recognize production first/continued prompts without altering the A draft path',async()=> {
  const doc=await exampleDocument(),scope=buildScope(doc);
  for(const provider of ['claude','codex']) {
    const run=request=> {
      const turn=turnFor({provider},request),prompt=turn.messages[0].text;
      const input=provider==='claude'?JSON.stringify({message:{content:[{text:prompt}]}}):prompt;
      const events=execFileSync(process.execPath,['scripts/lib/stand-in-cli.mjs',provider],{input,encoding:'utf8'}).trim().split('\n').map(JSON.parse);
      return provider==='claude'?events.find(e=>e.type==='result').result:events.find(e=>e.type==='item.completed').item.text;
    };
    const first=assemblePrompt(doc,scope,{lens:'logic',focus:'fixture:truncate',session:{mode:'start'}}),parser=new RecordParser({lens:'logic',blocks:scope.blocks});
    parser.push(run(first.request));const partial=parser.finish();assert.equal(partial.records.length,4);assert.equal(partial.metrics.truncated,true);
    const next=assemblePrompt(doc,scope,{lens:'logic',focus:'fixture:truncate',session:{mode:'continue',handle:'fixture'}});
    next.request.task=continuationTask(next.request.task,partial.records);const p=new RecordParser({lens:'logic',blocks:scope.blocks});p.seed(partial.records);p.push(run(next.request));
    const complete=p.finish();assert.equal(complete.records.length,6);assert.equal(complete.metrics.truncated,false);assert.equal(complete.metrics.validRate,1);
  }
});
