// E supplies cards and graphs. This text-only sink is also safe for streamed diagnostics.
export function recordElement(document,{record,flags=[]}) {
  const element=document.createElement('article');element.className='analysis-record';
  const label=document.createElement('strong');label.textContent=record.t;element.append(label);
  const text=document.createElement('p');text.textContent=Object.entries(record).filter(([k,v])=>k!=='t' && typeof v==='string').map(([,v])=>v).join(' · ');element.append(text);
  if(flags.length) {const status=document.createElement('small');status.textContent=flags.join(' · ');element.append(status);}
  const refs=record.refs??(record.ref?[record.ref]:[]);
  if(refs.length) {const anchors=document.createElement('p');anchors.textContent=refs.map(n=>`¶${n}`).join(', ');element.append(anchors);}
  return element;
}
export function createRecordSink(container) {
  return {record(entry){container.append(recordElement(container.ownerDocument,entry));},reset(){container.replaceChildren();}};
}
