export const REVIEW_DIMENSIONS=Object.freeze(['faithfulness','structuralAccuracy','argumentAccuracy','insight','usefulness']);
export function reviewForm(report){return {schemaVersion:1,reportId:report.id,sourceCommit:report.sourceCommit,promptVersion:report.promptVersion,
  instructions:'Review source and raw/canonical findings. Scores are 1 (poor) to 5 (excellent), or null before review. Record supported/inferred distinctions, language/script, actual translation, definition introduction and any canary-following. Stand-ins cannot establish semantic quality.',
  runs:report.runs.map(r=>({runId:r.id,item:r.item,provider:r.provider,lens:r.lens,action:r.action,reviewer:'',reviewedAt:null,disposition:'unreviewed',ratings:Object.fromEntries(REVIEW_DIMENSIONS.map(k=>[k,null])),notes:''}))};}
export function validateReviews(report,form){
  if(form?.schemaVersion!==1 || form.reportId!==report.id || form.sourceCommit!==report.sourceCommit || form.promptVersion!==report.promptVersion || !Array.isArray(form.runs))throw Error('REVIEW_REPORT_MISMATCH');
  const expected=new Map(report.runs.map(r=>[r.id,r])),seen=new Set();let complete=true;
  for(const row of form.runs){const run=expected.get(row.runId);if(!run || seen.has(row.runId) || ['item','provider','lens','action'].some(k=>row[k]!==run[k]))throw Error('REVIEW_RUN_MISMATCH');seen.add(row.runId);
    if(!['unreviewed','accepted','revise'].includes(row.disposition) || typeof row.reviewer!=='string' || typeof row.notes!=='string' || !row.ratings || Object.keys(row.ratings).length!==REVIEW_DIMENSIONS.length || REVIEW_DIMENSIONS.some(k=>row.ratings[k]!==null && (!Number.isInteger(row.ratings[k]) || row.ratings[k]<1 || row.ratings[k]>5)))throw Error('INVALID_REVIEW');
    if(row.disposition!=='unreviewed' && (!row.reviewer.trim() || typeof row.reviewedAt!=='string' || !Number.isFinite(Date.parse(row.reviewedAt)) || REVIEW_DIMENSIONS.some(k=>row.ratings[k]===null)))throw Error('INCOMPLETE_REVIEW');
    complete&&=row.disposition==='accepted';
  }
  return {complete:complete && seen.size===expected.size && expected.size>0,reviewed:form.runs.filter(r=>r.disposition!=='unreviewed').length,total:expected.size};
}
