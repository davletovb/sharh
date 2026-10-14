import {TextLayer} from 'pdfjs-dist/build/pdf.mjs';
import {resolvePDFAnchor} from '../../src/readers/pdf.mjs';
export class PDFView {
  constructor(container) { this.container=container; this.pages=new Map(); this.pdf=null; this.generation=0; }
  clear() { this.generation++; this.observer?.disconnect(); for (const page of this.pages.values()) page.task?.cancel(); this.pages.clear(); this.container.replaceChildren(); }
  async open(pdf,doc) {
    this.clear(); this.pdf=pdf; this.doc=doc;
    const generation=this.generation;
    this.observer=new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) this.render(Number(entry.target.dataset.page)).catch(error => { if(generation===this.generation) entry.target.dataset.error=error.message; }); }, {rootMargin:'500px'});
    // Empty placeholders keep long books from allocating a canvas/text layer for every page.
    const first=await pdf.getPage(1), viewport=first.getViewport({scale:1});
    for(let index=0; index<pdf.numPages; index++) {
      const label=document.createElement('p'); label.className='page-label'; label.textContent=`Page ${doc.pageLabels[index]} · PDF ${index+1}`;
      const el=document.createElement('div'); el.className='pdf-page'; el.dataset.page=index; el.style.width=`${viewport.width}px`; el.style.height=`${viewport.height}px`;
      this.container.append(label,el); this.pages.set(index,{el}); this.observer.observe(el);
    }
    await this.render(0);
  }
  async render(index) {
    const state=this.pages.get(index);
    if (!state) return;
    if (state.promise) return state.promise;
    const generation=this.generation;
    state.promise=(async () => {
      const page=await this.pdf.getPage(index+1), viewport=page.getViewport({scale:1});
      if (generation !== this.generation) return;
      state.el.style.width=`${viewport.width}px`; state.el.style.height=`${viewport.height}px`;
      const canvas=document.createElement('canvas'), pixelRatio=Math.min(devicePixelRatio || 1,2);
      canvas.width=Math.ceil(viewport.width*pixelRatio); canvas.height=Math.ceil(viewport.height*pixelRatio); canvas.style.width=`${viewport.width}px`; canvas.style.height=`${viewport.height}px`; canvas.setAttribute('aria-hidden','true');
      const text=document.createElement('div'); text.className='textLayer';
      const highlights=document.createElement('div'); highlights.className='pdf-highlights';
      state.el.append(canvas,text,highlights); state.highlights=highlights;
      state.task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:pixelRatio===1 ? null : [pixelRatio,0,0,pixelRatio,0,0]});
      await state.task.promise;
      const content=await page.getTextContent(), layer=new TextLayer({textContentSource:content,container:text,viewport});
      await layer.render();
      let divIndex=0; state.items=[];
      for (const [itemIndex,item] of content.items.entries()) if (typeof item.str === 'string') {
        const div=layer.textDivs[divIndex++]; if (div) { div.dataset.item=itemIndex; state.items[itemIndex]=div; }
      }
      state.el.dataset.rendered='true';
    })();
    return state.promise;
  }
  async highlight(anchor) {
    const hit=await resolvePDFAnchor(this.pdf,anchor);
    if (!hit) return null;
    await this.render(anchor.page);
    for (const state of this.pages.values()) state.highlights?.replaceChildren();
    const state=this.pages.get(anchor.page);
    for (const rect of hit.rects) {
      const el=document.createElement('div'); el.className='pdf-highlight';
      for (const [key,value] of Object.entries({left:rect.x,top:rect.y,width:rect.width,height:rect.height})) el.style[key]=`${value}px`;
      state.highlights.append(el);
    }
    state.el.scrollIntoView({block:'center'}); return hit;
  }
  selection() {
    const selection=getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range=selection.getRangeAt(0), spans=[];
    // The text layer retains PDF.js item indices; use only intersecting source items, not duplicate text elsewhere.
    for (const block of this.doc.blocks) {
      const state=this.pages.get(block.page), selectedItems=block.anchor.items.filter(index => {
        const el=state?.items?.[index]; return el && [...el.childNodes].some(node => node.nodeType===Node.TEXT_NODE && range.intersectsNode(node));
      });
      if (!selectedItems.length) continue;
      const selectedText=selection.toString().normalize('NFC').replace(/\s+/gu,' ').trim();
      const exact=block.text.indexOf(selectedText);
      // For multi-line dehyphenation or cross-block selections, include the intersecting block rather than invent offsets.
      spans.push({n:block.n,start:exact>=0 ? exact : 0,end:exact>=0 ? exact+selectedText.length : block.text.length});
    }
    return spans.length ? {spans,text:selection.toString()} : null;
  }
}
