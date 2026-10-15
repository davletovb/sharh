import {ENUMS} from '../../src/analysis/contract.mjs';
export function phaseTwoOutput(task,source){const block=source.blocks.find(b=>b.kind==='para'&&!b.text.includes('SHARH_INJECTION_CANARY'))??source.blocks[0],refs=[block.n],text='Deterministic Scholar toolkit fixture; no live quality claim.',rows=[{t:'meta',lens:task.lens,lang:task.outputLanguage??'en'}];
  if(task.lens==='themes')rows.push({t:'theme',id:'t1',label:'Fixture theme',text,refs},{t:'code',id:'c1',theme:'t1',label:'Fixture code',text},{t:'excerpt',code:'c1',ref:block.n,quote:block.text.slice(0,80)},{t:'memo',text});
  else if(task.lens==='meta-reading'||task.lens==='critique')for(const kind of task.lens==='critique'?ENUMS.critiqueFacet:ENUMS.metaFacet)rows.push({t:'facet',kind,text,refs,basis:'inferred'});
  else if(task.lens==='literature')rows.push({t:'cite',who:'Synthetic fixture author',role:'context',text,refs},...['context','debate','contribution'].map(kind=>({t:'facet',kind,text,refs,basis:'inferred'})));
  else if(task.lens==='terms')rows.push({t:'term',src:block.text.slice(0,24),tr:text,text,refs});
  else if(task.lens==='questions')for(const level of ENUMS.question)rows.push({t:'q',level,text,refs});
  else throw Error('UNKNOWN_PHASE_TWO_FIXTURE');return [...rows,{t:'end'}].map(r=>JSON.stringify(r)+'\n').join('');}
