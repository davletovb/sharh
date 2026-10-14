import {graphRecords} from '../../src/ui/graph-layout.mjs';
import {element,button,uid} from './dom.mjs';
const labels={sum:'Summary',arc:'Arc timeline',sec:'Outline',node:'Argument',edge:'Connections',step:'Reasoning steps',gap:'Gaps',concept:'Concepts',facet:'Thinking facets',note:'Notes',term:'Terms'};
const readable=s=>String(s??'').replaceAll('_',' ');
export function referenceButtons(doc,record,onReference) {
  const row=element('div','','references'),refs=record.refs??(record.ref?[record.ref]:[]);
  // Long section spans remain fully reachable without building ten thousand buttons.
  for(const n of refs.length>12?[...refs.slice(0,6),...refs.slice(-6)]:refs) {
    const block=doc?.blocks.find(b=>b.n===n),link=button(`¶${n}${block?.pageLabel?' · p. '+block.pageLabel:''}`,()=>onReference(n),'reference');link.dataset.ref=n;row.append(link);
  }
  if(refs.length>12)row.append(element('span',`${refs.length} paragraphs in this span`,'note'));
  return row;
}
export function createAnalysisView(container,{lens='summary',doc,onReference=()=>{},onInspect=()=>{},workerFactory=()=>new Worker(new URL('./graph-worker.mjs',location.href),{type:'module'})}={}) {
  const records=[],groups=new Map(),cards=new Map(),collapsed=new Set(),queue=[];let frame=null,disposed=false,ticket=0,layoutTimer=null,worker,mapBusy=false,layoutPending=false,pan={x:0,y:0,zoom:1},lastLayout=null,maxRenderMs=0;
  const root=element('div','','analysis-view'),mapLens=['structure','logic','thinking'].includes(lens),map=element('div','','map-shell'),mapStatus=element('p','','note'),outline=element('div','','text-outline');
  const outlineTitle=element('h3',mapLens?'Text outline':'Reading');outline.id=uid('text-outline');
  root.append(outlineTitle,outline);container.append(root);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('role','group');svg.setAttribute('aria-label',`${readable(lens)} map; use the text outline for all details`);svg.setAttribute('viewBox','0 0 500 240');svg.classList.add('analysis-map');
  function move(){if(lastLayout)svg.setAttribute('viewBox',`${pan.x} ${pan.y} ${lastLayout.width/pan.zoom} ${lastLayout.height/pan.zoom}`);}
  if(mapLens) {
    const controls=element('div','','map-controls');controls.setAttribute('aria-label','Map controls');
    controls.append(button('Zoom in',()=>{pan.zoom=Math.min(4,pan.zoom*1.25);move();}),button('Zoom out',()=>{pan.zoom=Math.max(.3,pan.zoom/1.25);move();}),button('Reset map',()=>{pan={x:0,y:0,zoom:1};move();}));
    for(const [label,x,y]of [['Pan left',-80,0],['Pan right',80,0],['Pan up',0,-80],['Pan down',0,80]])controls.append(button(label,()=>{pan.x+=x;pan.y+=y;move();}));
    const jump=element('a','Read text outline');jump.href='#'+outline.id;controls.append(jump);map.append(controls,svg,mapStatus);root.prepend(map);
    try{worker=workerFactory();worker.onmessage=({data})=>{mapBusy=false;if(disposed)return;if(data.id===ticket){if(data.error)mapStatus.textContent=data.error;else draw(data.layout);}if(layoutPending){layoutPending=false;scheduleLayout();}};worker.onerror=()=>{mapBusy=false;mapStatus.textContent='Map layout is unavailable. Use the text outline.';};}catch{mapStatus.textContent='Map layout is unavailable. Use the text outline.';}
  }
  function group(type) {
    if(!groups.has(type)){const section=element('section','','record-group'),heading=element('h4',type==='edge' && lens==='thinking'?'Causal chain and relations':labels[type]??readable(type)),list=element(type==='arc' || type==='step' || type==='sec'?'ol':'div','','record-list');section.append(heading,list);outline.append(section);groups.set(type,list);}
    return groups.get(type);
  }
  function inspect(entry){onInspect(entry);}
  function append(entry) {
    records.push(entry);const r=entry.record,ordered=['arc','step','sec'].includes(r.t),card=element(ordered?'li':'article','','finding '+r.t),title=element('h5');
    card.dataset.sequence=entry.sequence;if(r.id)card.dataset.recordId=r.id;
    const name=r.title??r.term??(r.t==='sum'?readable(r.level):r.kind?readable(r.kind):r.stage?`${r.n}. ${readable(r.stage)}`:r.n?`Step ${r.n}`:labels[r.t]??readable(r.t));
    title.append(button(name,()=>inspect(entry),'inspect-finding'));card.append(title);
    const text=r.gist??r.gloss??r.text;if(text){const p=element('p',text,'reading-text');p.dir='auto';card.append(p);}
    if(r.src)card.append(element('p',r.src,'source-term'));if(r.tr)card.append(element('p',r.tr,'translation'));
    if(r.basis)card.append(element('span',r.basis,'basis '+r.basis));
    if(r.t==='edge')card.append(element('p',`${r.from} → ${r.to} · ${readable(r.rel)}`));
    if(r.parent)card.append(element('p',`Part of ${r.parent}`,'note'));
    if(r.quote){const quote=element('blockquote',r.quote);quote.dir='auto';card.append(quote);}
    if(entry.flags?.length)card.append(element('p',entry.flags.map(readable).join(' · '),'validation-flags'));
    card.append(referenceButtons(doc,r,onReference));
    if(r.t==='sec') {
      const fold=button('Collapse branch',()=>{if(collapsed.has(r.id))collapsed.delete(r.id);else collapsed.add(r.id);fold.setAttribute('aria-expanded',String(!collapsed.has(r.id)));fold.textContent=collapsed.has(r.id)?'Expand branch':'Collapse branch';updateVisibility();scheduleLayout();});fold.setAttribute('aria-expanded','true');card.append(fold);
    }
    const list=group(r.t);if(ordered && r.n){const before=[...list.children].find(el=>Number(el.dataset.order)>r.n);card.dataset.order=r.n;list.insertBefore(card,before??null);}else list.append(card);
    if(r.id)cards.set(r.id,card);
  }
  function updateVisibility() {const visible=new Set(graphRecords(records,lens,[...collapsed]).nodes.map(n=>n.id));for(const [id,card]of cards)card.hidden=!visible.has(id);}
  function scheduleLayout(){if(!worker || layoutTimer!==null)return;layoutTimer=setTimeout(()=>{layoutTimer=null;if(disposed)return;if(mapBusy){layoutPending=true;return;}mapBusy=true;worker.postMessage({id:++ticket,lens,graph:graphRecords(records,lens,[...collapsed])});},80);}
  function draw(layout) {
    lastLayout=layout;svg.replaceChildren();const ns='http://www.w3.org/2000/svg',node=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs??{}))el.setAttribute(k,v);if(text)el.textContent=text;return el;};
    const defs=node('defs'),marker=node('marker',{id:uid('arrow'),viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(node('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'currentColor'}));defs.append(marker);svg.append(defs);
    const byId=new Map(layout.nodes.map(n=>[n.id,n]));
    for(const link of layout.links){const a=byId.get(link.from),b=byId.get(link.to);const g=node('g',{'class':'map-edge'});g.append(node('line',{x1:a.x,y1:a.y+32,x2:b.x,y2:b.y-32,'marker-end':`url(#${marker.id})`}),node('text',{x:(a.x+b.x)/2+8,y:(a.y+b.y)/2},readable(link.label)));svg.append(g);}
    for(const n of layout.nodes) {
      const label=readable(n.label),labelId=uid('map-label'),kindId=uid('map-kind'),descriptionId=uid('map-description'),g=node('g',{transform:`translate(${n.x-100},${n.y-32})`,tabindex:0,role:'button','aria-labelledby':`${labelId} ${kindId}`,'aria-describedby':descriptionId,'class':'map-node'});
      // SVG descriptions are not visible labels. Explicit hiding also keeps their
      // full text out of visual-name comparisons; labelledby uses the two visible lines.
      g.append(node('desc',{id:descriptionId,style:'display:none'},`${label}. Inspect finding.`),node('rect',{width:200,height:65,rx:9}),node('text',{id:labelId,x:12,y:24},[...label].slice(0,26).join('')),document.createTextNode(' '),node('text',{id:kindId,x:12,y:47,'class':'map-kind'},readable(n.kind)));
      const activate=()=>{const entry=records.find(e=>e.record.id===n.id);if(entry)inspect(entry);};g.addEventListener('click',activate);g.addEventListener('keydown',e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();activate();}});svg.append(g);
    }
    mapStatus.textContent=`${layout.nodes.length} nodes · ${layout.links.length} connections. All findings are also in the text outline.`;move();
  }
  function flush() {
    frame=null;if(disposed)return;const start=performance.now();let count=0;
    while(queue.length && count++<8 && performance.now()-start<6)append(queue.shift());
    maxRenderMs=Math.max(maxRenderMs,performance.now()-start);if(queue.length)frame=requestAnimationFrame(flush);else scheduleLayout();
  }
  return {record(entry){queue.push(structuredClone(entry));if(frame===null)frame=requestAnimationFrame(flush);},reset(){queue.length=0;records.length=0;groups.clear();cards.clear();collapsed.clear();outline.replaceChildren();svg.replaceChildren();lastLayout=null;ticket++;},
    async settled(){while(queue.length || frame!==null)await new Promise(resolve=>setTimeout(resolve,16));},get metrics(){return {records:records.length,maxRenderMs};},
    dispose(){disposed=true;if(frame!==null)cancelAnimationFrame(frame);clearTimeout(layoutTimer);worker?.terminate();root.remove();}};
}
