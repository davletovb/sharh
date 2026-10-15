import {portableRow,encodeBytes} from '../documents/archive.mjs';
import {safeURL} from '../analysis/contract.mjs';
import {STORE_KEYS,validateArchive} from '../documents/store.mjs';
const md=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/([\\`*_[\]#|])/g,'\\$1');
export function markdown(saved,doc){
  const source=safeURL(doc.address),link=n=>{const original=doc.blocks?.find(b=>b.n===n)?.source,url=safeURL(original?.address??source),label=original?`${md(original.title)} · ¶${original.n}`:`¶${n}`;return url?`[${label}](${url.replaceAll('(','%28').replaceAll(')','%29')})`:label;};
  const blocks=saved.records.map(({record:r,flags=[]})=>[
    `## ${md(r.title??r.label??r.term??r.who??r.kind??r.level??r.t)}`,md(r.gist??r.gloss??r.text??''),
    r.src?`Original: ${md(r.src)}`:'',r.tr?`Translation: ${md(r.tr)}`:'',r.quote?`> ${md(r.quote)}`:'',r.basis?`Basis: ${r.basis}`:'',
    (r.refs??(r.ref?[r.ref]:[])).map(link).join(' · '),r.url&&flags.includes('source_verified')?`Search source: <${safeURL(r.url)}>`:'',
    flags.length?`Validation: ${md(flags.join(', '))}`:''
  ].filter(Boolean).join('\n\n'));
  return [`# ${md(doc.title)}`,source?`Source: <${source}>`:'Source: saved local extraction',`Lens: ${md(saved.run.config?.customLens?.name??saved.run.lens)} · version ${saved.run.version}`,saved.run.config?.frame?`Reading frame: ${md(saved.run.config.frame)}`:'',...blocks].filter(Boolean).join('\n\n')+'\n';
}
export function runArchive(saved,doc,source=null,dependencies=[]){
  if(saved.run.docId!==doc.id || saved.run.extractionVersion!==doc.version)throw Error('EXPORT_EXTRACTION_CHANGED');
  const {blocks,sections,...meta}=doc,stores=Object.fromEntries(Object.keys(STORE_KEYS).filter(k=>k!=='maintenance').map(k=>[k,[]]));
  stores.docs=[meta];stores.extractions=[{...meta,docId:doc.id}];stores.blocks=blocks.map(b=>({...b,docId:doc.id,version:doc.version}));stores.sections=sections.map(s=>({...s,docId:doc.id,version:doc.version}));stores.runs=[portableRow(saved.run)];stores.records=saved.records.map(e=>({...e,runId:saved.run.id}));
  if(source)stores.sources=[{...source,docId:doc.id,version:doc.version,...(source.bytes?{bytes:encodeBytes(source.bytes)}:{})}];
  for(const {doc:original,source:bytes}of dependencies){if(!original)throw Error('EXPORT_SOURCE_REMOVED');const {blocks:bs,sections:ss,...meta}=original;if(!stores.docs.some(d=>d.id===meta.id))stores.docs.push(meta);if(stores.extractions.some(e=>e.docId===meta.id&&e.version===meta.version))continue;stores.extractions.push({...meta,docId:meta.id});stores.blocks.push(...bs.map(b=>({...b,docId:meta.id,version:meta.version})));stores.sections.push(...ss.map(s=>({...s,docId:meta.id,version:meta.version})));if(bytes)stores.sources.push({...bytes,...(bytes.bytes?{bytes:encodeBytes(bytes.bytes)}:{})});}
  const archive={format:'sharh-documents',version:2,stores};validateArchive(archive);return archive;
}
export function download(blob,name,{document=globalThis.document,URL=globalThis.URL}={}){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
export async function mapPNG(svg){const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('MAP_IMAGE_FAILED'));image.src=url;});const canvas=document.createElement('canvas'),ratio=Math.min(2,6000/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.ceil(image.width*ratio));canvas.height=Math.max(1,Math.ceil(image.height*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('MAP_IMAGE_FAILED')),'image/png'));}finally{URL.revokeObjectURL(url);}}
