import {transaction,idbRequest as read} from '../documents/idb.mjs';
const key=s=>s.normalize('NFC').trim().toLocaleLowerCase('und');
const length=s=>[...s.normalize('NFC')].length;
export const MAX_CAPTURED_TERMS=1000,MAX_GLOSSARY_BYTES=32768;
export function glossaryEntry(row){if(!row||typeof row.bookId!=='string'||typeof row.term!=='string'||!row.term.trim()||length(row.term)>200||typeof row.translation!=='string'||!row.translation.trim()||length(row.translation)>1200||typeof (row.note??'')!=='string'||length(row.note??'')>1200||!Array.isArray(row.aliases??[])||(row.aliases??[]).some(a=>typeof a!=='string'||!a.trim()||length(a)>200)||typeof(row.language??'und')!=='string'||![undefined,'suggested','kept'].includes(row.status)||!Array.isArray(row.refs??[])||(row.refs??[]).some(n=>!Number.isSafeInteger(n)||n<1))throw Error('INVALID_GLOSSARY_ENTRY');return {...row,term:row.term.normalize('NFC').trim(),translation:row.translation.normalize('NFC').trim(),aliases:[...new Set((row.aliases??[]).map(s=>s.normalize('NFC').trim()))],note:(row.note??'').normalize('NFC'),language:row.language??'und',refs:[...new Set(row.refs??[])]};}
export const isSuggested=row=>row?.status==='suggested';
export const glossaryKey=key;
// A term a model suggested is shown for the reader to keep. Until then it is not sent to any prompt.
export const glossarySnapshot=(rows,language=null)=>rows.filter(r=>!isSuggested(r)).filter(r=>!language||!r.language||r.language==='und'||r.language===language||!r.language.includes('-')&&language.split('-')[0]===r.language).map(r=>({term:r.term,translation:r.translation,aliases:r.aliases??[],note:r.note??'',language:r.language??'und'}));
export function scopedGlossary(rows,scope){
 if(!Array.isArray(rows))throw Error('INVALID_GLOSSARY');
 if(!rows.length)return [];
 const text=key(scope.blocks.map(b=>b.selected?b.selected.map(s=>b.text.slice(s.start,s.end)).join('\n'):b.text).join('\n')),selected=[];let bytes=2;
 for(const row of rows){if(typeof row?.term!=='string'||typeof row.translation!=='string'||length(row.term)>200||length(row.translation)>1200||!Array.isArray(row.aliases??[])||(row.aliases??[]).some(a=>typeof a!=='string'||length(a)>200)||typeof(row.note??'')!=='string'||length(row.note??'')>1200)throw Error('INVALID_GLOSSARY');
  if(![row.term,...(row.aliases??[])].some(s=>key(s)&&text.includes(key(s))))continue;
  const size=new TextEncoder().encode(JSON.stringify(row)).length+(selected.length?1:0);if(bytes+size>MAX_GLOSSARY_BYTES||selected.length===1000)continue;selected.push(structuredClone(row));bytes+=size;
 }return selected;
}
export class Glossary {
 constructor(store){this.store=store;}
 async list(bookId){return transaction(this.store.db,'glossary','readonly',async tx=>(await read(tx.objectStore('glossary').index('bookId').getAll(bookId))).sort((a,b)=>a.term.localeCompare(b.term)));}
 async save(value){const row=glossaryEntry({...value,status:value.status??'kept'});return transaction(this.store.db,['docs','glossary'],'readwrite',async tx=>{if(!await read(tx.objectStore('docs').getKey(row.bookId)))throw Error('DOCUMENT_REMOVED');const rows=await read(tx.objectStore('glossary').index('bookId').getAll(row.bookId)),names=new Set([row.term,...row.aliases].map(key));if(rows.some(r=>r.term!==row.term&&[r.term,...(r.aliases??[])].some(s=>names.has(key(s)))))throw Error('An alias already belongs to another term. Edit that entry instead.');tx.objectStore('glossary').put({...row,updatedAt:Date.now()});return row;});}
 // Keep turns a suggestion into one of the reader's own terms, or adds a term straight from a card.
 async keep(bookId,entry){const names=new Set([entry.term,...(entry.aliases??[])].map(key)),existing=(await this.list(bookId)).find(r=>[r.term,...(r.aliases??[])].some(a=>names.has(key(a))));return this.save(existing?{...existing,status:'kept'}:{...entry,bookId,status:'kept'});}
 async state(bookId,term){const row=(await this.list(bookId)).find(r=>[r.term,...(r.aliases??[])].some(a=>key(a)===key(term)));return row?(isSuggested(row)?'suggested':'kept'):null;}
 async remove(bookId,term){return transaction(this.store.db,'glossary','readwrite',tx=>tx.objectStore('glossary').delete([bookId,term]));}
 async capture(saved){if(saved.run.status!=='completed')return;const terms=saved.records.map(e=>e.record).filter(r=>r.t==='term'&&length(r.src)<=200);if(!terms.length)return;return transaction(this.store.db,['docs','glossary'],'readwrite',async tx=>{if(!await read(tx.objectStore('docs').getKey(saved.run.docId)))return;const rows=await read(tx.objectStore('glossary').index('bookId').getAll(saved.run.docId)),known=new Set(rows.flatMap(r=>[r.term,...(r.aliases??[])].map(key)));let count=rows.length;for(const r of terms){if(count>=MAX_CAPTURED_TERMS)break;if(known.has(key(r.src)))continue;const row=glossaryEntry({bookId:saved.run.docId,term:r.src,translation:r.tr,note:r.text,refs:r.refs,aliases:[],language:saved.run.config.language,status:'suggested'});tx.objectStore('glossary').put(row);known.add(key(r.src));count++;}});}
}
