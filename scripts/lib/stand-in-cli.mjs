// Test-only provider CLI. Never use as a live-model quality result.
import {readFileSync} from 'node:fs';
import {standInOutput} from './draft-prompts.mjs';
const [provider, ...args] = process.argv.slice(2);
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (provider === 'codex' && args[0] === 'login') { process.stderr.write('Logged in using ChatGPT\n'); }
else if (provider === 'claude' && args[0] === 'auth') emit({loggedIn:true, authMethod:'claude.ai'});
else {
  const raw = readFileSync(0, 'utf8');
  const prompt = provider === 'claude' ? JSON.parse(raw).message.content[0].text : raw;
  const match = prompt.match(/SHARH_DOCUMENT_JSON\n([^\n]+)\nSHARH_TASK\nDraft (structure|logic) lens/);
  if (!match) throw new Error('STAND_IN_EXPECTED_DRAFT_PROMPT');
  const scope = JSON.parse(match[1]), lens = match[2], output = standInOutput(lens, scope);
  if (provider === 'codex') {
    emit({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'});
    emit({type:'turn.started'});
    emit({type:'item.completed',item:{id:'answer',type:'agent_message',text:output}});
    emit({type:'turn.completed',usage:{input_tokens:100,output_tokens:100}});
  } else {
    const session_id = '00000000-0000-4000-8000-000000000002';
    emit({type:'system',subtype:'init',session_id});
    // Claude stream-json reports partial deltas and a final result.
    for (let i = 0; i < output.length; i += 47) emit({type:'stream_event',session_id,event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:output.slice(i,i+47)}}});
    emit({type:'result',subtype:'success',is_error:false,result:output,session_id,usage:{input_tokens:100,output_tokens:100}});
  }
}
