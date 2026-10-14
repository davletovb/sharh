import test from 'node:test';
import assert from 'node:assert/strict';
import {probeClient,probeStatuses} from '../scripts/lib/probe-client.mjs';
const listeners=()=>{let callback;return {addListener:fn=>callback=fn,emit:value=>callback?.(value)}};
function port(){return {onMessage:listeners(),onDisconnect:listeners(),sent:[],postMessage(frame){this.sent.push(frame)},disconnect(){this.onDisconnect.emit()}};}
test('handshake and fresh status checks cover every provider, never plain send',async()=>{
  const p=port(),c=probeClient(p);p.onMessage.emit({type:'ready',version:1});
  p.postMessage=frame=>{p.sent.push(frame);queueMicrotask(()=>{p.onMessage.emit({id:frame.id,event:{type:'status',status:{availability:'available'}}});p.onMessage.emit({id:frame.id,event:{type:'completed'}});});};
  const providers=['claude','codex','gemini','grok'];assert.equal((await probeStatuses(c,providers)).length,4);
  assert.deepEqual(p.sent.map(f=>f.provider),providers);assert.ok(p.sent.every(f=>f.method==='readiness'&&f.params.mode==='fresh'));c.close();
});
test('request bytes are checked before posting and sent requests are never replayed',async()=>{
  const p=port(),c=probeClient(p);p.onMessage.emit({type:'ready',version:1});
  await assert.rejects(c.request('codex','status',{text:'я'.repeat(600000)}),/REQUEST_TOO_LARGE/);assert.equal(p.sent.length,0);
  const waiting=c.request('codex','status');await Promise.resolve();p.onDisconnect.emit();await assert.rejects(waiting,/DISCONNECTED/);assert.equal(p.sent.length,1);
});
test('wrong protocol and missing ready time out without generation',async()=>{
  const p=port(),c=probeClient(p);p.onMessage.emit({type:'ready',version:2});await assert.rejects(c.ready,/PROTOCOL_VERSION/);
  const p2=port(),c2=probeClient(p2,{timeoutMs:5});await assert.rejects(c2.ready,/READY_TIMEOUT/);assert.equal(p2.sent.length,0);
});
test('one callback overflow cancels only its target, drains late events and leaves later probes usable',async()=>{
  const p=port(),c=probeClient(p);p.onMessage.emit({type:'ready',version:1});
  p.postMessage=function(frame){this.sent.push(frame);if(frame.method==='cancel')queueMicrotask(()=>this.onMessage.emit({id:frame.target,event:{type:'stopped'}}));};
  const failed=c.request('codex','send_ready_with_policy',{},()=>{throw new Error('OUTPUT_CAP_EXCEEDED')});
  const other=c.request('claude','readiness');await Promise.resolve();
  const [target,otherFrame]=p.sent;
  p.onMessage.emit({id:target.id,event:{type:'delta',text:'oversized'}});
  await assert.rejects(failed,/OUTPUT_CAP_EXCEEDED/);
  assert.equal(p.sent.at(-1).target,target.id);assert.equal(p.sent.at(-1).method,'cancel');
  p.onMessage.emit({id:target.id,event:{type:'delta',text:'late'}});p.onMessage.emit({id:target.id,event:{type:'completed'}});
  p.onMessage.emit({id:otherFrame.id,event:{type:'completed'}});await other;
  const next=c.request('codex','readiness');await Promise.resolve();p.onMessage.emit({id:p.sent.at(-1).id,event:{type:'completed'}});await next;c.close();
});
