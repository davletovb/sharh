// Explicit synthetic answers exercise mechanics, never provider quality.
import {ENUMS} from '../../src/analysis/contract.mjs';
const labels={en:'Deterministic fixture; no semantic quality claim.',ru:'Синтетический пример; качество модели не измерено.','uz-Latn':'Sun’iy misol; model sifati baholanmagan.','uz-Cyrl':'Сунъий мисол; модел сифати баҳоланмаган.',tr:'Sentetik örnek; model kalitesi ölçülmedi.',ar:'مثال اصطناعي؛ لم يتم تقييم جودة النموذج.'};
export function phaseOneOutput(task,source){
  const {lens,action=null,operation=null,outputLanguage=source.lang??'en'}=task,text=labels[outputLanguage]??labels.en;
  const first=source.blocks.find(b=>b.selected)??source.blocks.find(b=>b.kind==='para' && !b.text.includes('SHARH_INJECTION_CANARY'))??source.blocks[0],refs=[first.n],rows=[{t:'meta',lens,lang:outputLanguage}];
  const logic=()=>rows.push({t:'node',id:'p1',kind:'premise',text,refs,basis:'stated',quote:first.text.slice(0,80)},
    {t:'node',id:'c1',kind:'claim',text,refs,basis:'inferred'},{t:'edge',from:'p1',to:'c1',rel:'supports'},
    {t:'step',n:1,text,refs},{t:'gap',kind:'unstated_premise',at:['c1'],text,refs});
  if(action==='Logic')logic();
  else if(action==='Argument')rows.push(...[['claim','stated'],['reason','inferred'],['weakness','inferred']].map(([part,basis])=>({t:'chk',part,text,refs,basis})));
  else if(action){rows.push({t:'note',text,refs});if(action==='Translate' || action==='Define')rows.push({t:'term',src:first.text.slice(first.selected?.[0]?.start??0,first.selected?.[0]?.end??40),tr:text,text,refs});}
  else if(lens==='summary'&&operation==='gist')for(const level of ['line','abstract'])rows.push({t:'sum',level,text,refs});
  else if(lens==='summary'){for(const level of ENUMS.level)rows.push({t:'sum',level,text,refs});ENUMS.stage.forEach((stage,i)=>rows.push({t:'arc',n:i+1,stage,text,refs}));}
  else if(lens==='structure'){
    const headings=source.blocks.filter(b=>b.kind==='heading');if(!headings.length)rows.push({t:'sec',id:'s1',title:source.title||text,role:'context',gist:text,span:[source.blocks[0].n,source.blocks.at(-1).n]});
    // An outline is flat and short: no nesting, at most twelve sections.
    if(operation==='outline')headings.slice(0,12).forEach((h,i)=>{const next=headings[i+1];rows.push({t:'sec',id:'s'+(i+1),title:h.text,role:'context',gist:text,span:[h.n,(next?.n??source.blocks.at(-1).n+1)-1]});});
    else{const stack=[];for(const [i,h]of headings.entries()){while(stack.length && stack.at(-1).level>=h.level)stack.pop();const next=headings.slice(i+1).find(n=>n.level<=h.level),id='s'+(i+1);rows.push({t:'sec',id,...(stack.length?{parent:stack.at(-1).id}:{}),title:h.text,role:'context',gist:text,span:[h.n,(next?.n??source.blocks.at(-1).n+1)-1]});stack.push({id,level:h.level});}}
  }else if(lens==='logic')logic();
  else if(lens==='thinking'){rows.push({t:'concept',id:'a',term:text,src:first.text.slice(0,30),gloss:text,refs},{t:'concept',id:'b',term:text,gloss:text,refs},{t:'edge',from:'a',to:'b',rel:'causes'});for(const kind of ENUMS.thinkingFacet)rows.push({t:'facet',kind,text,refs,basis:'inferred'});}
  else throw Error('UNKNOWN_PHASE_ONE_FIXTURE');
  return [...rows,{t:'end'}].map(r=>JSON.stringify(r)+'\n').join('');
}
