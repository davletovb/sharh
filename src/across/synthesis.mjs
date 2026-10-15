import {createDocument,versionOf,makeSections} from '../documents/model.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {validateItem} from './library.mjs';
import {BookJobs} from './books.mjs';
import {runWithFailover} from './failover.mjs';
export async function collectionDocument(store,items,{kind,collectionId=null,digests=[]}={}){
 if(!['literature-review','meta-synthesis','compare'].includes(kind)||items.length<2||items.length>100||(kind==='compare'&&items.length!==2)||new Set(items.map(i=>i.id)).size!==items.length)throw Error('Choose distinct library items (exactly two for Compare).');
 const blocks=[],sections=[],sources=[];
 for(const item of items){const doc=await store.getDocument(item.docId,item.version),scope=validateItem(item,doc),section={id:'s'+(sections.length+1),title:item.title,level:1,parent:null,first:blocks.length+1,last:0},evidence=new Map(),saved=digests.find(d=>d.itemId===item.id);
  if(kind!=='compare'&&!saved)throw Error('Finish digests for every library item first.');
  if(saved){for(const chapter of saved.chapters)for(const {record:r}of chapter.records){for(const n of r.refs??[]){if(!scope.blocks.some(b=>b.n===n))throw Error('DIGEST_OUTSIDE_LIBRARY_ITEM');if(!evidence.has(n))evidence.set(n,[]);evidence.get(n).push(r);}}}
  else for(const b of scope.blocks)evidence.set(b.n,[{text:b.text}]);
  if(!evidence.size)throw Error('A library item has no anchored digest evidence.');
  for(const [original,records]of [...evidence].sort((a,b)=>a[0]-b[0])){const n=blocks.length+1,text=saved?JSON.stringify({digestEvidence:records}):records[0].text,source={docId:doc.id,version:doc.version,n:original,itemId:item.id,title:item.title,address:doc.address};blocks.push({n,kind:'para',text,section:section.id,source,anchor:{type:'html',path:`[data-n="${n}"]`,quote:{exact:text,prefix:'',suffix:''},position:{start:n,end:n+text.length}}});}
  section.last=blocks.length;sections.push(section);sources.push({docId:doc.id,version:doc.version,itemId:item.id,title:item.title,scope:item.scope,digestRunIds:saved?.chapters.map(c=>c.runId)??[]});
 }
 const identity='sharh:across:'+JSON.stringify([kind,collectionId,items.map(i=>i.id)]),version=await versionOf(identity,JSON.stringify({blocks,sources}));
 const doc=createDocument({extractorVersion:'across-1',version,blocks,sections},{kind:'html',identity,title:kind==='compare'?'Compare · '+items.map(i=>i.title).join(' / '):kind==='meta-synthesis'?'Collection meta-synthesis':'Collection literature review'});doc.derived={kind,collectionId,sources};await store.saveDocument(doc);return doc;
}
export class AcrossTexts {
 constructor(engine){this.engine=engine;this.store=engine.store;this.books=new BookJobs(engine);}
 async prepare(items,{kind,collectionId,target,language='en',policy={mode:'ask',targets:[]},glossary,...config},options={}){const digests=[];
  if(!Array.isArray(items)||!['literature-review','meta-synthesis','compare'].includes(kind)||items.length<2||items.length>100||kind==='compare'&&items.length!==2||new Set(items.map(i=>i.id)).size!==items.length)throw Error('Choose distinct library items (exactly two for Compare).');
  if(kind!=='compare')for(const item of items){
   const doc=await this.store.getDocument(item.docId,item.version),scope=validateItem(item,doc);
   // A new manifest uses the exact current model, prompt and glossary snapshot.
   // BookJobs reuses only matching completed chapter runs, never a loosely matched job.
   const job=await this.books.create({...config,doc,scope,target,language},{policy});
   await this.books.run(job.id,options);
   const saved=await this.books.digests(job.id);digests.push({itemId:item.id,chapters:saved.chapters});
  }
  return collectionDocument(this.store,items,{kind,collectionId,digests});
 }
 async run(doc,{target,policy={mode:'ask',targets:[]},...config},options={}){if(!doc.derived)throw Error('Choose a prepared cross-text source.');return runWithFailover(this.engine,{...config,doc,scope:buildScope(doc),target,lens:doc.derived.kind,operation:null,customLens:null,action:null,tier:'synthesis',priority:'interactive',persistent:false,glossary:[]},policy,options);}
}
