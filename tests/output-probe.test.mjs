import test from 'node:test';
import assert from 'node:assert/strict';
import {runOutputProbe,reportPasses} from '../scripts/lib/run-output-probe.mjs';
import {standInOutput} from '../scripts/lib/draft-prompts.mjs';
const scope={blocks:[{n:1,kind:'heading',text:'A question'},{n:2,kind:'para',text:'Evidence has limits.'}]};
const contract={revision:'test-pin',reading_policy:{allowed_sign_in:{claude:['subscription'],codex:['subscription']}}};
test('one extraction failure leaves earlier measurements intact and fails the overall gate',async()=>{
  const report=await runOutputProbe({fixture:true,items:[{id:'good'},{id:'broken'}],providers:['claude','codex'],extract:async item=>{if(item.id==='broken')throw new Error('NO_TEXT_BLOCKS');return scope;},contract});
  assert.equal(report.runs.length,8);assert.equal(report.runs.filter(r=>r.outcome==='completed').length,4);
  assert.equal(report.runs[0].metrics.referenceValidity,1);assert.ok(report.runs.slice(4).every(r=>r.failure==='EXTRACTION_FAILED: NO_TEXT_BLOCKS'));assert.equal(reportPasses(report),false);
});
test('probe uses protected sending and never generates for API-key or unknown sign-ins',async()=>{
  for(const signIn of ['subscription','api_key','unknown',null]){
    const methods=[];
    const client={async request(provider,method,params,onEvent){methods.push(method);if(method==='readiness')onEvent({type:'status',status:{availability:'available',authentication:'authenticated',sign_in:signIn,capabilities:{tool_isolation:true}}});else{assert.equal(method,'send_ready_with_policy');assert.deepEqual(params.allowed_sign_in,['subscription']);assert.equal(params.turn.tools,'none');assert.equal(params.turn.check_sign_in,false);onEvent({type:'delta',text:standInOutput(methods.length===2?'structure':'logic',scope)});}}};
    const report=await runOutputProbe({client,items:[{id:'a'}],providers:['codex'],extract:async()=>scope,contract});
    assert.equal(methods.filter(m=>m==='send_ready_with_policy').length,signIn==='subscription'?2:0);
    if(signIn!=='subscription')assert.ok(report.runs.every(r=>r.failure==='SIGN_IN_POLICY_DENIED'));
  }
});
test('an unsupported readiness method is measured, with zero fallback sends',async()=>{
  const methods=[];
  const client={async request(provider,method){methods.push(method);throw Object.assign(new Error('old companion'),{reason:'READINESS_UNSUPPORTED'});}};
  const report=await runOutputProbe({client,items:[{id:'a'}],providers:['claude'],extract:async()=>scope,contract});
  assert.deepEqual(methods,['readiness','readiness']);assert.ok(report.runs.every(r=>r.failure==='READINESS_UNSUPPORTED'));
});
test('a headingless structure run passes; removing a logic run’s stated quotation fails compliance',async()=>{
  const report=await runOutputProbe({fixture:true,items:[{id:'headingless'}],providers:['claude'],extract:async()=>({blocks:[{n:1,kind:'para',text:'A short observation.'}]}),contract});
  assert.equal(report.runs[0].metrics.headingCoverage,null);assert.equal(reportPasses(report),true);
  report.runs[1].metrics.quotationVerification=null;report.runs[1].metrics.verifiedStatedQuotations=0;assert.equal(reportPasses(report),false);
});
