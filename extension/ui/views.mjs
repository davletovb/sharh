import {graphRecords} from '../../src/ui/graph-layout.mjs';
import {element,button,uid} from './dom.mjs';
const labels={chk:'Argument check',finding:'Cross-text findings',cell:'Evidence matrix',sum:'Summary',arc:'Arc timeline',sec:'Outline',node:'Argument',edge:'Connections',step:'Reasoning steps',gap:'Gaps',concept:'Concepts',facet:'Reading facets',note:'Notes',term:'Terms',theme:'Themes',code:'Codes',excerpt:'Excerpts',tension:'Tensions',memo:'Analytic memos',cite:'Citations',q:'Questions'};
const readable=s=>String(s??'').replaceAll('_',' ');
// In the conversation, kinds and levels get plain names, and the cards stand alone: no table repeats them and no map opens uninvited.
const PLAIN_KIND=Object.freeze({genre:'Genre',audience:'Who it is for',purpose:'What it is for',position:'Where the author stands',context:'Context',framing:'How it is framed',silence:'What is left unsaid',strength:'Strength',weakness:'Weakness',evidence_quality:'Quality of the evidence',counterargument:'A counterargument',debate:'The debate',contribution:'What it adds',question:'The question it asks',evidence_standard:'What counts as evidence',reasoning_mode:'How it reasons',assumption:'An assumption',worldview:'Worldview',lineage:'Influences',normative:'Values',blind_spot:'Blind spot',falsifier:'What could change the conclusion',other:'Other'});
const PLAIN_LEVEL=Object.freeze({comprehension:'Did you follow it?',analysis:'Look closer',evaluation:'Weigh it',debate:'Argue about it'});
const PLAIN_BASIS=Object.freeze({stated:'Stated in the text',inferred:'Inferred'});
// An argument check reads top to bottom whatever order the parts arrive in.
const CHECK_ORDER=Object.freeze(['claim','reason','strength','weakness','assessment','detail']);
const CHECK_NAME=Object.freeze({assumption:'Assumption',objection:'Strongest objection'});
const CHECK_HEADING=Object.freeze({claim:'Main claim',reason:'Reasons and support',strength:'Strongest point',weakness:'Weakest link',assessment:'What the text establishes',detail:'Assumptions and the strongest objection'});
// Paragraph marks inside running text (¶8, ¶12–13, [¶17]) open that paragraph, like the chips under a finding. A range opens its first paragraph.
export function linkReferences(node,text,doc,onReference) {
  const pattern=/¶\s?(\d+)(?:\s?[–-]\s?\d+)?/g;let last=0,match;
  for(;(match=pattern.exec(text));) {
    const n=Number(match[1]),block=doc?.blocks.find(b=>b.n===n);if(!block)continue;
    if(match.index>last)node.append(document.createTextNode(text.slice(last,match.index)));
    const original=(block.source?.refs??[block.source?.n??null])[0],link=button(match[0],()=>onReference(n,original),'inline-ref');link.dataset.ref=n;link.setAttribute('aria-label',`Go to paragraph ${n}`);node.append(link);last=pattern.lastIndex;
  }
  if(last<text.length)node.append(document.createTextNode(text.slice(last)));
}
export function referenceButtons(doc,record,onReference) {
  const row=element('div','','references'),refs=(record.refs??(record.ref?[record.ref]:[])).flatMap(n=>{const block=doc?.blocks.find(b=>b.n===n);return (block?.source?.refs??[block?.source?.n??null]).map(original=>({n,original,block}));});
  // Long section spans remain fully reachable without building ten thousand buttons.
  for(const {n,original,block} of refs.length>12?[...refs.slice(0,6),...refs.slice(-6)]:refs) {
    const link=button(block?.source?`${block.source.title} · ¶${original}`:`¶${n}${block?.pageLabel?' · p. '+block.pageLabel:''}`,()=>onReference(n,original),'reference');link.dataset.ref=n;row.append(link);
  }
  if(refs.length>12)row.append(element('span',`${refs.length} paragraphs in this span`,'note'));
  return row;
}
export function createAnalysisView(container,{lens='summary',gist=false,compact=false,flat=false,keep=null,doc,onReference=()=>{},onInspect=()=>{},workerFactory=()=>new Worker(new URL('./graph-worker.mjs',location.href),{type:'module'})}={}) {
  const records=[],groups=new Map(),cards=new Map(),collapsed=new Set(),queue=[];let frame=null,disposed=false,ticket=0,layoutTimer=null,worker,mapBusy=false,layoutPending=false,pan={x:0,y:0,zoom:1},lastLayout=null,maxRenderMs=0,visible=new Set();
  const root=element('div','','analysis-view'),mapLens=!flat&&['structure','logic','thinking'].includes(lens),map=element('div','','map-shell'),mapStatus=element('p','','note'),outline=element('div','','text-outline');
  const outlineTitle=element('h3',mapLens?'Text outline':'Reading');outline.id=uid('text-outline');
  root.append(outlineTitle,outline);container.append(root);
  root.dataset.lens=lens;
  const across=['meta-synthesis','compare'].includes(lens),tabular=across||!compact&&['themes','literature','terms'].includes(lens),table=element('table','','reading-table');
  if(tabular){table.append(element('caption',across?'Evidence matrix':lens==='themes'?'Codebook and source excerpts':lens==='terms'?'Contextual glossary':'Citations in the text'));outline.before(table);}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('role','group');svg.setAttribute('aria-label',`${readable(lens)} map; use the text outline for all details`);svg.setAttribute('viewBox','0 0 500 240');svg.classList.add('analysis-map');
  function move(){if(lastLayout)svg.setAttribute('viewBox',`${pan.x} ${pan.y} ${lastLayout.width/pan.zoom} ${lastLayout.height/pan.zoom}`);}
  if(mapLens) {
    const controls=element('div','','map-controls');controls.setAttribute('aria-label','Map controls');
    controls.append(button('Zoom in',()=>{pan.zoom=Math.min(4,pan.zoom*1.25);move();}),button('Zoom out',()=>{pan.zoom=Math.max(.3,pan.zoom/1.25);move();}),button('Reset map',()=>{pan={x:0,y:0,zoom:1};move();}));
    for(const [label,x,y]of [['Pan left',-80,0],['Pan right',80,0],['Pan up',0,-80],['Pan down',0,80]])controls.append(button(label,()=>{pan.x+=x;pan.y+=y;move();}));
    const jump=element('a','Read text outline');jump.href='#'+outline.id;controls.append(jump);map.append(controls,svg,mapStatus);root.prepend(map);
    if(compact){const toggle=button('Show map',()=>{const open=map.hidden;map.hidden=!open;toggle.textContent=open?'Hide map':'Show map';toggle.setAttribute('aria-expanded',String(open));if(open)scheduleLayout();},'ghost map-toggle');toggle.setAttribute('aria-expanded','false');map.hidden=true;map.before(toggle);toggle.setAttribute('aria-controls',map.id=uid('map'));}
    try{worker=workerFactory();worker.onmessage=({data})=>{mapBusy=false;if(disposed)return;if(data.id===ticket){if(data.error)mapStatus.textContent=data.error;else draw(data.layout);}if(layoutPending){layoutPending=false;scheduleLayout();}};worker.onerror=()=>{mapBusy=false;mapStatus.textContent='Map layout is unavailable. Use the text outline.';};}catch{mapStatus.textContent='Map layout is unavailable. Use the text outline.';}
  }
  function group(type,record) {
    if(type==='chk') {
      const key=['assumption','objection'].includes(record.part)?'detail':record.part,rank=CHECK_ORDER.indexOf(key);
      if(!groups.has(key)){
        const fold=key==='detail',section=element(fold?'details':'section','',`record-group check-part${fold?' record-fold':''}`),list=element('div','','record-list');
        section.dataset.part=key;section.dataset.order=rank;section.append(element(fold?'summary':'h4',CHECK_HEADING[key]),list);
        outline.insertBefore(section,[...outline.children].find(el=>Number(el.dataset.order)>rank)??null);groups.set(key,list);
      }
      return groups.get(key);
    }
    const key=lens==='critique'&&type==='facet'?({strength:'strengths',evidence_quality:'evidence'}[record.kind]??'limitations'):type;
    if(!groups.has(key)){const section=element('section','','record-group'),heading=element('h4',key==='strengths'?'Strengths':key==='limitations'?'Limitations and counterarguments':key==='evidence'?'Quality of the evidence':type==='edge' && lens==='thinking'?'Causal chain and relations':labels[type]??readable(type)),list=element(type==='arc' || type==='step' || type==='sec'?'ol':'div','','record-list');section.append(heading,list);outline.append(section);groups.set(key,list);}
    return groups.get(key);
  }
  function inspect(entry){onInspect(entry);}
  // In the conversation the summary lens is the gist: the point and the abstract, nothing more. The other lenses hold the detail.
  const onlyGist=gist&&lens==='summary';
  // A flat outline is a scannable list of sections with their paragraph ranges. The text without headings says so.
  const onlyOutline=flat&&lens==='structure';
  if(onlyOutline&&doc&&!doc.blocks.some(b=>b.kind==='heading'))outline.before(element('p','Inferred outline: this text has no headings, so these sections are reconstructed from how it moves. Each range points to the paragraphs it covers.','hint inferred-outline'));
  function append(entry) {
    records.push(entry);if(onlyGist&&!(entry.record.t==='sum'&&['line','abstract'].includes(entry.record.level)))return;if(onlyOutline&&entry.record.t!=='sec')return;const r=entry.record,ordered=['arc','step','sec'].includes(r.t),card=element(ordered?'li':'article','','finding '+r.t),title=element('h5');
    card.dataset.sequence=entry.sequence;if(r.id)card.dataset.recordId=r.id;if(r.level)card.dataset.level=r.level;
    const name=r.title??r.label??r.term??(r.t==='term'?r.src:null)??r.who??(r.level?readable(r.level):r.kind?readable(r.kind):r.stage?`${r.n}. ${readable(r.stage)}`:r.n?`Step ${r.n}`:r.part?CHECK_NAME[r.part]??readable(r.part):labels[r.t]??readable(r.t));
    const plain=compact?(r.t==='q'?PLAIN_LEVEL[r.level]:r.t==='facet'?PLAIN_KIND[r.kind]:null):null;
title.append(button(plain??name,()=>inspect(entry),'inspect-finding'));if(r.t!=='chk'||['assumption','objection'].includes(r.part))card.append(title);else card.dataset.part=r.part;
    const text=r.gist??r.gloss??r.text;if(text){const p=element('p','','reading-text');p.dir='auto';linkReferences(p,text,doc,onReference);card.append(p);}
    if(r.support){const supporting=new Set((r.refs??[]).map(n=>doc?.blocks.find(b=>b.n===n)?.source?.itemId).filter(Boolean));card.append(element('p',`${supporting.size} supporting text${supporting.size===1?'':'s'} · ${r.support}`,'support-note'));}if(r.criterion)card.append(element('p',r.criterion));
    if(r.src&&r.src!==name)card.append(element('p',r.src,'source-term'));if(r.tr&&r.tr!==r.src)card.append(element('p',r.tr,'translation'));
    if(r.basis)card.append(element('span',compact||lens==='check'?PLAIN_BASIS[r.basis]??r.basis:r.basis,'basis '+r.basis));
    if(r.t==='edge'){const named=id=>{const found=records.find(e=>e.record.id===id)?.record,label=found?.label??found?.term??found?.text??id;return [...label].length>60?[...label].slice(0,57).join('')+'…':label;};card.append(element('p',compact?`${named(r.from)} → ${named(r.to)} · ${readable(r.rel)}`:`${r.from} → ${r.to} · ${readable(r.rel)}`));}
    if(r.parent&&!onlyOutline)card.append(element('p',`Part of ${r.parent}`,'note'));
    if(r.theme || r.code)card.append(element('p',`Linked to ${r.theme??r.code}`,'note'));if(r.a)card.append(element('p',`${r.a} ↔ ${r.b}`));if(r.work)card.append(element('p',r.work));
    if(r.url){if(entry.flags?.includes('source_verified')){const a=element('a','Open verified search source');a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}else card.append(element('p','Unverified external link · no matching search source','validation-flags'));}
    if(r.quote){const quote=element('blockquote',r.quote);quote.dir='auto';card.append(quote);}
    if(entry.flags?.length)card.append(element('p',entry.flags.map(readable).join(' · '),'validation-flags'));
    if(onlyOutline){const [first,last]=r.span,block=doc?.blocks.find(b=>b.n===first),original=(block?.source?.refs??[block?.source?.n??null])[0],row=element('div','','references'),range=button(first===last?`¶${first}`:`¶${first}–${last}`,()=>onReference(first,original),'reference');range.dataset.ref=first;row.append(range);card.append(row);}
    else card.append(referenceButtons(doc,r,onReference));
    // A term on a card can be kept in the book's glossary. Until it is kept it is only a suggestion.
    if(compact&&keep&&r.t==='term'){
      const mark=()=>{kept.textContent='In your glossary';kept.disabled=true;kept.classList.add('kept');kept.setAttribute('aria-label',`${r.src} is in your glossary`);};
      const kept=button('Keep in glossary',async()=>{await keep.save(r);mark();},'ghost keep-term');kept.setAttribute('aria-label',`Keep in glossary: ${r.src}`);
      Promise.resolve(keep.state(r.src)).then(state=>{if(state==='kept')mark();}).catch(()=>{});card.append(kept);
    }
    if(r.t==='sec'&&!onlyOutline) {
      const fold=button('Collapse branch',()=>{if(collapsed.has(r.id))collapsed.delete(r.id);else collapsed.add(r.id);fold.setAttribute('aria-expanded',String(!collapsed.has(r.id)));fold.textContent=collapsed.has(r.id)?'Expand branch':'Collapse branch';updateVisibility();scheduleLayout();});fold.setAttribute('aria-expanded','true');card.append(fold);
    }
    const list=group(r.t,r);if(ordered && r.n){const before=[...list.children].find(el=>Number(el.dataset.order)>r.n);card.dataset.order=r.n;list.insertBefore(card,before??null);}else list.append(card);
    card.dataset.refs=(r.refs??(r.ref?[r.ref]:[])).join(',');
    if(r.id)cards.set(r.id,card);
  }
  function tableRows(){if(!tabular)return;if(across){matrix();return;}table.querySelectorAll('thead,tbody').forEach(n=>n.remove());const head=element('thead'),tr=element('tr'),body=element('tbody');for(const label of lens==='themes'?['Theme','Code','Excerpt','Paragraph']:lens==='terms'?['Original','Translation','Meaning','Paragraph']:['Author / work','Role','Use in this text','Paragraph']){const th=element('th',label);th.scope='col';tr.append(th);}head.append(tr);const rs=records.map(e=>e.record),byId=new Map(rs.filter(r=>r.id).map(r=>[r.id,r]));for(const r of rs.filter(r=>lens==='themes'?r.t==='excerpt':lens==='terms'?r.t==='term':r.t==='cite')){const row=element('tr'),code=byId.get(r.code),values=lens==='themes'?[byId.get(code?.theme)?.label??'',code?.label??'',r.quote??'Unverified excerpt omitted']:lens==='terms'?[r.src,r.tr,r.text]:[[r.who,r.work].filter(Boolean).join(' · '),r.role,r.text];for(const text of values)row.append(element('td',text));const cell=element('td');cell.append(referenceButtons(doc,r,onReference));row.append(cell);body.append(row);}table.append(head,body);}
  function matrix(){table.querySelectorAll('thead,tbody').forEach(n=>n.remove());const sources=doc.derived?.sources??[],head=element('thead'),row=element('tr');row.append(element('th','Criterion'));for(const item of sources)row.append(element('th',item.title));head.append(row);const body=element('tbody');for(const criterion of ['question','method','data','findings','concepts','stance']){const row=element('tr');row.append(element('th',readable(criterion)));for(const item of sources){const cell=element('td'),matches=records.filter(e=>e.record.t==='cell'&&e.record.item===item.itemId&&e.record.criterion===criterion);if(!matches.length)cell.append(element('p','Not reported in this reading.'));for(const e of matches){cell.append(element('p',e.record.text),referenceButtons(doc,e.record,onReference));}row.append(cell);}body.append(row);}table.append(head,body);}
  function highlightVisible(){for(const card of root.querySelectorAll('[data-sequence]')){const refs=(card.dataset.refs??'').split(',').map(Number),active=refs.some(n=>visible.has(n));card.classList.toggle('in-source-view',active);if(active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');}for(const node of svg.querySelectorAll('[data-record-id]'))node.classList.toggle('in-source-view',cards.get(node.dataset.recordId)?.classList.contains('in-source-view')===true);}
  function updateVisibility() {const visible=new Set(graphRecords(records,lens,[...collapsed]).nodes.map(n=>n.id));for(const [id,card]of cards)card.hidden=!visible.has(id);}
  function scheduleLayout(){if(!worker || layoutTimer!==null)return;layoutTimer=setTimeout(()=>{layoutTimer=null;if(disposed)return;if(mapBusy){layoutPending=true;return;}mapBusy=true;worker.postMessage({id:++ticket,lens,graph:graphRecords(records,lens,[...collapsed])});},80);}
  function draw(layout) {
    lastLayout=layout;svg.replaceChildren();const ns='http://www.w3.org/2000/svg',node=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs??{}))el.setAttribute(k,v);if(text)el.textContent=text;return el;};
    const defs=node('defs'),marker=node('marker',{id:uid('arrow'),viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(node('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'currentColor'}));defs.append(marker);svg.append(defs);
    const byId=new Map(layout.nodes.map(n=>[n.id,n]));
    for(const link of layout.links){const a=byId.get(link.from),b=byId.get(link.to);const g=node('g',{'class':'map-edge'});g.append(node('line',{x1:a.x,y1:a.y+32,x2:b.x,y2:b.y-32,'marker-end':`url(#${marker.id})`}),node('text',{x:(a.x+b.x)/2+8,y:(a.y+b.y)/2},readable(link.label)));svg.append(g);}
    for(const n of layout.nodes) {
      const label=readable(n.label),labelId=uid('map-label'),kindId=uid('map-kind'),descriptionId=uid('map-description'),g=node('g',{transform:`translate(${n.x-100},${n.y-32})`,tabindex:0,role:'button','aria-labelledby':`${labelId} ${kindId}`,'aria-describedby':descriptionId,'class':'map-node','data-record-id':n.id});
      // SVG descriptions are not visible labels. Explicit hiding also keeps their
      // full text out of visual-name comparisons; labelledby uses the two visible lines.
      g.append(node('desc',{id:descriptionId,style:'display:none'},`${label}. Inspect finding.`),node('rect',{width:200,height:65,rx:9}),node('text',{id:labelId,x:12,y:24},[...label].slice(0,26).join('')),document.createTextNode(' '),node('text',{id:kindId,x:12,y:47,'class':'map-kind'},readable(n.kind)));
      const activate=()=>{const entry=records.find(e=>e.record.id===n.id);if(entry)inspect(entry);};g.addEventListener('click',activate);g.addEventListener('keydown',e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();activate();}});svg.append(g);
    }
    mapStatus.textContent=`${layout.nodes.length} nodes · ${layout.links.length} connections. All findings are also in the text outline.`;move();highlightVisible();
  }
  function flush() {
    frame=null;if(disposed)return;const start=performance.now();let count=0;
    while(queue.length && count++<8 && performance.now()-start<6)append(queue.shift());
    maxRenderMs=Math.max(maxRenderMs,performance.now()-start);if(queue.length)frame=requestAnimationFrame(flush);else{scheduleLayout();tableRows();highlightVisible();}
  }
  return {source:{docId:doc?.id,version:doc?.version},record(entry){queue.push(structuredClone(entry));if(frame===null)frame=requestAnimationFrame(flush);},reset(){queue.length=0;records.length=0;groups.clear();cards.clear();collapsed.clear();outline.replaceChildren();table.querySelectorAll('thead,tbody').forEach(n=>n.remove());svg.replaceChildren();lastLayout=null;ticket++;},
    setVisibleParagraphs(numbers){const next=new Set(numbers);if(next.size===visible.size&&[...next].every(n=>visible.has(n)))return;visible=next;highlightVisible();},
    async exportSVG(){const until=performance.now()+5000;while(!disposed && (queue.length || frame!==null || layoutTimer!==null || mapBusy) && performance.now()<until)await new Promise(r=>setTimeout(r,20));if(!lastLayout)throw Error('A map is not available for this view.');const copy=svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',lastLayout.width);copy.setAttribute('height',lastLayout.height);copy.setAttribute('viewBox',`0 0 ${lastLayout.width} ${lastLayout.height}`);const originals=[svg,...svg.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];clones.forEach((el,i)=>{const s=getComputedStyle(originals[i]);for(const key of ['fill','stroke','stroke-width','color','font-family','font-size','font-weight'])el.style.setProperty(key,s.getPropertyValue(key));});return new XMLSerializer().serializeToString(copy);},
    async settled(){while(queue.length || frame!==null)await new Promise(resolve=>setTimeout(resolve,16));},get metrics(){return {records:records.length,maxRenderMs};},
    dispose(){disposed=true;if(frame!==null)cancelAnimationFrame(frame);clearTimeout(layoutTimer);worker?.terminate();root.remove();}};
}
