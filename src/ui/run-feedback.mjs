const reasons={type:'missing or unsupported record type',parse:'incomplete or invalid JSON',fields:'missing or invalid fields',enum:'unsupported field value',references:'invalid paragraph reference format',identifier:'invalid identifier',meta:'incorrect lens metadata',meta_order:'misplaced metadata',framing:'plain text instead of records',dangling_identifier:'links to missing findings',line_limit:'response line too long',output_limit:'response too long'};
export function resultMessage(run,count,{loaded=false}={}) {
  const findings=`${count} valid finding${count===1?'':'s'}`;
  if(run.status==='invalid')return `Response format failed · ${findings} saved. The model did not return the required format, and its format repair did not succeed.`;
  if(run.status==='failed' || run.status==='interrupted')return `Run ${run.status} · ${findings} saved. ${run.error?.reason??run.error?.code??'See response details.'}`;
  if(loaded)return `Loaded ${count} saved findings. No new analysis requested.`;
  return `${run.status==='completed'?'Completed':'Partial result saved'} · ${count} findings.`;
}
export function responseDetails(run) {
  return (run.attempts??[]).flatMap((attempt,index)=>{
    const m=attempt.metrics??{},label=attempt.kind==='repair'?'Format repair':`Response ${index+1}`,lines=[];
    if(Number.isFinite(m.recordLines))lines.push(`${label}: ${m.newValidRecords??0} valid findings from ${m.recordLines} response records.`);
    for(const [reason,count]of Object.entries(m.dropped??{}))if(count)lines.push(`${label}: ${count} ${reasons[reason]??'invalid records'}.`);
    if(attempt.error)lines.push(`${label}: ${attempt.error.code??'failed'} · ${attempt.error.reason??''}`);
    if(attempt.rejection)lines.push(`${label} was not accepted (${attempt.rejection}).`);
    return lines;
  });
}
