import {TextLayer} from 'pdfjs-dist/build/pdf.mjs';
import {resolvePDFAnchor} from '../../src/readers/pdf.mjs';
import {pdfTextOffsets} from '../../src/documents/model.mjs';
export class PDFView {
  constructor(container) { this.container=container;this.pages=new Map();this.generation=0;this.near=new Set(); }
  clear() {
    this.generation++;this.observer?.disconnect();
    for(const index of this.pages.keys())this.unrender(index);
    this.pages.clear();this.near.clear();this.doc=null;this.pdf=null;this.container.replaceChildren();
  }
  unrender(index) {
    const state=this.pages.get(index);if(!state)return;
    state.epoch=(state.epoch||0)+1;state.task?.cancel();state.layer?.cancel();
    for(const canvas of state.el.querySelectorAll('canvas')){canvas.width=0;canvas.height=0;}
    state.el.replaceChildren();delete state.el.dataset.rendered;
    state.promise=null;state.task=null;state.layer=null;state.items=null;state.content=null;state.highlights=null;state.offsets=null;
  }
  async open(pdf,doc,{observe=true}={}) {
    this.clear();this.pdf=pdf;this.doc=doc;this.byPage=new Map();this.pinned=0;
    for(const block of doc.blocks){if(!this.byPage.has(block.page))this.byPage.set(block.page,[]);this.byPage.get(block.page).push(block);}
    const first=await pdf.getPage(1),viewport=first.getViewport({scale:1});
    for(let index=0;index<pdf.numPages;index++) {
      const label=document.createElement('p');label.className='page-label';label.textContent=`Page ${doc.pageLabels[index]} · PDF ${index+1}`;
      const el=document.createElement('div');el.className='pdf-page';el.dataset.page=index;el.style.width=`${viewport.width}px`;el.style.height=`${viewport.height}px`;
      this.container.append(label,el);this.pages.set(index,{el,epoch:0});
    }
    await this.render(0);
    if(observe)this.startObserving();
  }
  selectionPages() {
    const selection=getSelection();if(!selection?.rangeCount || selection.isCollapsed)return [];
    const pageOf=node=>(node.nodeType===1?node:node.parentElement)?.closest('.pdf-page');
    return [pageOf(selection.getRangeAt(0).startContainer),pageOf(selection.getRangeAt(0).endContainer)]
      .filter(el=>el && this.container.contains(el)).map(el=>Number(el.dataset.page));
  }
  startObserving() {
    this.observer?.disconnect();const generation=this.generation;
    this.observer=new IntersectionObserver(entries=> {
      for(const entry of entries) {
        const index=Number(entry.target.dataset.page);
        if(entry.isIntersecting) {
          this.near.add(index);
          this.render(index).catch(error=>{if(generation===this.generation && error.name!=='RenderingCancelledException')entry.target.dataset.error=error.message;});
        } else this.near.delete(index);
      }
      this.releaseDistant();
    },{rootMargin:'500px'});
    for(const {el} of this.pages.values())this.observer.observe(el);
  }
  releaseDistant() {
    const protectedPages=new Set([...this.selectionPages(),this.pinned]);
    for(const [index,state]of this.pages)if(!this.near.has(index) && !protectedPages.has(index) && state.promise)this.unrender(index);
  }
  async render(index) {
    const state=this.pages.get(index);if(!state)return;
    if(state.promise)return state.promise;
    const generation=this.generation,epoch=state.epoch,pdf=this.pdf;
    const current=()=>generation===this.generation && epoch===state.epoch && pdf===this.pdf;
    state.promise=(async()=> {
      const page=await pdf.getPage(index+1),viewport=page.getViewport({scale:1});if(!current())return;
      state.el.style.width=`${viewport.width}px`;state.el.style.height=`${viewport.height}px`;
      const canvas=document.createElement('canvas'),ratio=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;canvas.setAttribute('aria-hidden','true');
      const text=document.createElement('div');text.className='textLayer';
      state.highlights=document.createElement('div');state.highlights.className='pdf-highlights';state.el.append(canvas,text,state.highlights);
      state.task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
      await state.task.promise;if(!current())return;
      const content=await page.getTextContent();if(!current())return;
      const layer=new TextLayer({textContentSource:content,container:text,viewport});state.layer=layer;await layer.render();if(!current())return;
      let divIndex=0;state.items=[];state.content=content;state.offsets=new Map();
      for(const [itemIndex,item]of content.items.entries())if(typeof item.str==='string') {
        const div=layer.textDivs[divIndex++];if(div){div.dataset.item=itemIndex;state.items[itemIndex]=div;}
      }
      delete state.el.dataset.error;state.el.dataset.rendered='true';
    })().catch(error=>{if(current())this.unrender(index);throw error;});
    return state.promise;
  }
  async highlight(anchor) {
    if(!this.pdf)return null;
    const hit=await resolvePDFAnchor(this.pdf,anchor);if(!hit)return null;
    const previous=this.pinned;this.pinned=anchor.page;
    const state=this.pages.get(anchor.page);state.el.scrollIntoView({block:'center'});await this.render(anchor.page);
    for(const page of this.pages.values())page.highlights?.replaceChildren();
    for(const rect of hit.rects) {
      const el=document.createElement('div');el.className='pdf-highlight';
      for(const [key,value]of Object.entries({left:rect.x,top:rect.y,width:rect.width,height:rect.height}))el.style[key]=`${value}px`;
      state.highlights.append(el);
    }
    if(previous!==this.pinned)this.releaseDistant();return hit;
  }
  selection() {
    if(!this.doc)return null;
    const selection=getSelection();if(!selection?.rangeCount || selection.isCollapsed)return null;
    const range=selection.getRangeAt(0);if(!range.intersectsNode(this.container))return null;
    const endpoints=this.selectionPages(),first=endpoints[0]??0,last=endpoints.at(-1)??this.doc.pageCount-1,spans=[];
    for(let page=first;page<=last;page++)for(const block of this.byPage.get(page)||[]) {
      if(page>first && page<last || !endpoints.length){spans.push({n:block.n,start:0,end:block.text.length});continue;}
      const state=this.pages.get(page);if(!state?.content)continue;
      let raw='';const selected=[];
      for(const [at,index]of block.anchor.items.entries()) {
        raw+=block.anchor.separators[at];const offset=raw.length,text=state.content.items[index].str;raw+=text;
        const el=state.items[index],node=el?.firstChild;if(!node || node.nodeType!==Node.TEXT_NODE || !range.intersectsNode(node))continue;
        const start=range.startContainer===node?range.startOffset:range.startContainer===el?(range.startOffset?text.length:0):0;
        const end=range.endContainer===node?range.endOffset:range.endContainer===el?(range.endOffset?text.length:0):text.length;
        if(end>start)selected.push({start:offset+start,end:offset+end});
      }
      if(!selected.length)continue;
      let map=state.offsets.get(block.n);if(!map){map=pdfTextOffsets(raw);state.offsets.set(block.n,map);}
      if(map.text!==block.text)continue;
      for(const part of selected){const normalized=map.range(part.start,part.end);if(normalized)spans.push({n:block.n,...normalized});}
    }
    return spans.length?{spans,text:selection.toString()}:null;
  }
}
