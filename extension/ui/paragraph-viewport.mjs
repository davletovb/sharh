// Observe source elements once; scrolling never scans the document's block list.
export class ParagraphViewport {
  constructor(onChange,{Observer=globalThis.IntersectionObserver,schedule=fn=>globalThis.queueMicrotask(fn)}={}) {
    this.onChange=onChange;this.schedule=schedule;this.targets=new Map();this.visible=new Set();this.pending=false;
    this.observer=Observer?new Observer(entries=>{for(const e of entries)if(this.targets.has(e.target)){if(e.isIntersecting)this.visible.add(e.target);else this.visible.delete(e.target);}this.changed();}):null;
  }
  reset(source) {this.observer?.disconnect();this.targets.clear();this.visible.clear();this.source=source;this.lastKey=null;this.changed();}
  observe(element,numbers) {this.targets.set(element,numbers);this.observer?.observe(element);}
  unobserve(element) {this.observer?.unobserve(element);this.targets.delete(element);this.visible.delete(element);this.changed();}
  changed() {if(this.pending)return;this.pending=true;this.schedule(()=>{this.pending=false;this.report();});}
  report() {
    const numbers=[...new Set([...this.visible].flatMap(el=>{const value=this.targets.get(el);return typeof value==='function'?value():value??[];}))].sort((a,b)=>a-b),key=JSON.stringify([this.source,numbers]);
    if(key===this.lastKey)return;this.lastKey=key;if(this.source)this.onChange(numbers,this.source);
  }
  dispose() {this.observer?.disconnect();this.targets.clear();this.visible.clear();this.source=null;}
}
