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
  let output,pause=false;
  if(match)output=standInOutput(match[2],JSON.parse(match[1]));
  else {
    const taskMatch=prompt.match(/SHARH_TASK\n(\{[^\n]+\})/),sourceMatch=prompt.match(/(\{"title":[^\n]+\})\n\nSHARH_TASK\n/);
    if(!taskMatch)throw new Error('STAND_IN_EXPECTED_SHARH_PROMPT');
    const task=JSON.parse(taskMatch[1]);
    pause=task.focus==='fixture:pause';
    if(sourceMatch) {
      output=standInOutput(task.lens,JSON.parse(sourceMatch[1]));
      if(task.focus==='fixture:truncate')output=output.replace('{"t":"end"}\n','');
    } else {
      // A session follow-up contains the task and retained records, but no document layer.
      const retainedMatch=prompt.match(/SHARH_RETAINED_RECORDS_JSON\n(\[[^\n]+\])/);
      if(!retainedMatch)throw new Error('STAND_IN_EXPECTED_RETAINED_RECORDS');
      const retained=JSON.parse(retainedMatch[1]),first=retained.find(r=>r.t==='node'),id=`next${retained.length+1}`;
      output=[{t:'node',id,kind:'claim',text:'Deterministic continuation; no live quality claim.',refs:first?.refs??[3],basis:'inferred'},
        {t:'edge',from:first?.id??id,to:id,rel:'supports'},{t:'end'}].map(r=>JSON.stringify(r)).join('\n')+'\n';
    }
  }
  if (provider === 'codex') {
    emit({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'});
    emit({type:'turn.started'});
    emit({type:'item.completed',item:{id:'answer',type:'agent_message',text:output}});
    emit({type:'turn.completed',usage:{input_tokens:100,output_tokens:100}});
  } else {
    const session_id = '00000000-0000-4000-8000-000000000002';
    emit({type:'system',subtype:'init',session_id});
    if(pause)await new Promise(resolve=>setTimeout(resolve,1000));
    // Claude stream-json reports partial deltas and a final result.
    for (let i = 0; i < output.length; i += 47) emit({type:'stream_event',session_id,event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:output.slice(i,i+47)}}});
    emit({type:'result',subtype:'success',is_error:false,result:output,session_id,usage:{input_tokens:100,output_tokens:100}});
  }
}
