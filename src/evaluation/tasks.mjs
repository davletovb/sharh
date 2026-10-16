import {TASKS} from '../analysis/tasks.mjs';
const words=text=>String(text).trim().split(/\s+/).filter(Boolean).length;
// What an instruction promises and a machine can check: how many of each record, how long, and no paragraph marks
// inside the text. Whether the answer is any good is a reader's judgment, so these are floors, never a quality claim.
export function taskChecks(taskId,rows) {
  const problems=[],of=(t,part)=>rows.filter(r=>r.t===t&&(part===undefined||r.part===part));
  const range=(name,n,min,max)=>{if(n<min)problems.push(`${taskId}:${name}_too_few`);if(n>max)problems.push(`${taskId}:${name}_too_many`);};
  const plain=(name,list)=>{if(list.some(r=>/¶/.test(r.text??'')))problems.push(`${taskId}:${name}_paragraph_marks`);};
  const argument=(withAssumptions=true)=>{
    range('claim',of('chk','claim').length,1,1);range('reason',of('chk','reason').length,2,3);range('assessment',of('chk','assessment').length,1,1);
    range('strength',of('chk','strength').length,0,1);range('weakness',of('chk','weakness').length,0,1);
    if(withAssumptions){range('assumption',of('chk','assumption').length,0,2);range('objection',of('chk','objection').length,0,1);}
    plain('argument',of('chk'));
  };
  if(!Object.hasOwn(TASKS,taskId))return problems;
  switch(taskId){
    case 'gist':{
      const sums=of('sum'),line=sums.find(r=>r.level==='line'),abstract=sums.find(r=>r.level==='abstract');
      range('records',rows.length,2,2);range('line',sums.filter(r=>r.level==='line').length,1,1);range('abstract',sums.filter(r=>r.level==='abstract').length,1,1);
      if(line&&words(line.text)>25)problems.push('gist:line_over_25_words');if(abstract&&words(abstract.text)>70)problems.push('gist:abstract_over_70_words');
      if(sums.some(r=>(r.refs??[]).length>5))problems.push('gist:too_many_references');plain('gist',sums);break;
    }
    case 'argument':argument();range('records',rows.length,4,10);break;
    case 'terms':range('terms',of('term').length,1,8);range('records',rows.length,1,8);break;
    case 'outline':range('sections',of('sec').length,1,12);if(of('sec').some(r=>r.parent))problems.push('outline:nested');break;
    case 'ideas':range('ideas',of('theme').length,3,5);range('records',rows.length,3,5);break;
    case 'questions':range('questions',of('q').length,3,5);if(!of('q').some(r=>r.level==='comprehension'))problems.push('questions:no_comprehension_question');break;
    case 'deep':
      range('synthesis',of('sum').length,1,1);if(of('sum').some(r=>r.level!=='brief'))problems.push('deep:synthesis_not_brief');if(of('sum').some(r=>words(r.text)>140))problems.push('deep:synthesis_over_120_words');
      range('sections',of('sec').length,1,8);if(of('sec').some(r=>r.parent))problems.push('deep:nested');range('questions',of('q').length,0,3);argument();plain('synthesis',of('sum'));break;
    default:break;
  }
  return problems;
}
