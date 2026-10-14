import {textOffsets,contentHash} from '../documents/model.mjs';
const boundarySelector='h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,figcaption,table,td,th,div,section,article,main,body';
const excludedSelector='script,style,nav,footer,aside,[hidden],[aria-hidden="true"],.social-share,.share-buttons';
export const blockSelector='h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,figcaption,table';
function entries(root,{exclude=true}={}) {
  const walker=root.ownerDocument.createTreeWalker(root,5,{acceptNode(node){return exclude && node.nodeType===1 && node.matches(excludedSelector)?2:1;}}), out=[];
  if(exclude && root.closest(excludedSelector))return out;
  let previousBoundary,breaks=0;
  for(let node;(node=walker.nextNode());) {
    if(node.nodeType===1){if(node.tagName==='BR')breaks++;continue;}
    const boundary=node.parentElement.closest(boundarySelector);
    out.push({node,boundary,breaks:Math.max(breaks,previousBoundary && boundary!==previousBoundary?1:0)});
    previousBoundary=boundary;breaks=0;
  }
  return out;
}
export const textNodes=(root,options)=>entries(root,options).map(e=>e.node);
export function textMap(root) {
  const rawStarts=new Map(),spans=[],chunks=[];let rawSize=0,signature;
  for(const {node,breaks} of entries(root)) {
    if(breaks && chunks.length){chunks.push('\n');rawSize++;}
    rawStarts.set(node,rawSize);spans.push({node,start:rawSize,end:rawSize+node.data.length});chunks.push(node.data);rawSize+=node.data.length;
  }
  const raw=chunks.join(''),normalized=textOffsets(raw);
  function point(rawIndex,end) {
    let lo=0,hi=spans.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(spans[mid].end<rawIndex || !end && spans[mid].end===rawIndex)lo=mid+1;else hi=mid;}
    const span=spans[Math.min(lo,spans.length-1)];
    return {node:span.node,offset:Math.max(0,Math.min(span.node.length,rawIndex-span.start))};
  }
  function rawPosition(container,offset,end) {
    if(rawStarts.has(container))return rawStarts.get(container)+offset;
    const boundary=root.ownerDocument.createRange();boundary.setStart(container,offset);boundary.collapse(true);
    let lo=0,hi=spans.length;
    while(lo<hi){
      const mid=(lo+hi)>>1,probe=root.ownerDocument.createRange(),span=spans[mid];
      probe.setStart(span.node,end?0:span.node.length);probe.collapse(true);
      if(probe.compareBoundaryPoints(0,boundary)<(end?0:1))lo=mid+1;else hi=mid;
    }
    return end?(lo?spans[lo-1].end:0):(spans[lo]?.start??raw.length);
  }
  return {text:normalized.text,
    get signature(){return signature??=contentHash(new TextEncoder().encode(normalized.text));},
    range(start,end){
      if(start<0 || end>normalized.text.length || end<=start)return null;
      const a=point(normalized.starts[start],false),b=point(normalized.ends[end-1],true),range=root.ownerDocument.createRange();
      range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);return range;
    },
    position(range){return {start:normalized.offset(rawPosition(range.startContainer,range.startOffset,false)),end:normalized.offset(rawPosition(range.endContainer,range.endOffset,true),true)};}
  };
}
export function collectRuns(root) {
  const runs=[];let last;
  for(const {node,boundary,breaks} of entries(root)) {
    const table=node.parentElement.closest('table');
    const owner=table && root.contains(table)?table:node.parentElement.closest(blockSelector) || boundary || root;
    if(!root.contains(owner)){last=null;continue;}
    if(last?.element!==owner || breaks>=2){last={element:owner,raw:'',nodes:[]};runs.push(last);}
    if(last.raw && breaks)last.raw+='\n';
    last.raw+=node.data;last.nodes.push(node);
  }
  return runs.filter(r=>r.raw.trim());
}
