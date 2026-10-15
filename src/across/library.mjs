import {transaction,idbRequest as read} from '../documents/idb.mjs';
import {scopeDescriptor,scopeKey} from '../analysis/prompts.mjs';
import {buildScope} from '../documents/scopes.mjs';
import {restoreScope} from '../toolkit/workflows.mjs';
const LIBRARY='sharh-library';
export function itemKey(item){return JSON.stringify([item.docId,item.version,item.scope]);}
export function validateItem(item,doc){if(doc?.derived)throw Error('Save an original document or chapter, not a derived report. Reports already remain in saved reading history.');if(!item||typeof item.id!=='string'||!item.id||item.docId!==doc?.id||item.version!==doc.version||typeof item.title!=='string'||!item.scope||!['document','chapter','section'].includes(item.scope.kind))throw Error('INVALID_LIBRARY_ITEM');const scope=restoreScope(doc,item.scope);if(!scope.blocks.length||scope.blocks.some((b,i)=>i&&b.n!==scope.blocks[i-1].n+1))throw Error('INVALID_LIBRARY_SCOPE');return scope;}
export class Library {
 constructor(store){this.store=store;}
 async items(){return (await this.store.all('collections')).find(c=>c.id===LIBRARY)?.items??[];}
 async collections(){return (await this.store.all('collections')).filter(c=>c.id!==LIBRARY).sort((a,b)=>(a.order??0)-(b.order??0)||a.id.localeCompare(b.id));}
 async edit(action){return transaction(this.store.db,['docs','extractions','collections'],'readwrite',action);}
 async save(doc,scope=buildScope(doc)){const item={id:crypto.randomUUID(),docId:doc.id,version:doc.version,title:scope.kind==='document'?doc.title:doc.title+' · '+scope.label,scope:scopeDescriptor(scope)};validateItem(item,doc);return this.edit(async tx=>{if(!await read(tx.objectStore('docs').getKey(doc.id))||!await read(tx.objectStore('extractions').getKey([doc.id,doc.version])))throw Error('DOCUMENT_REMOVED');const library=await read(tx.objectStore('collections').get(LIBRARY))??{id:LIBRARY,kind:'library',name:'Library',items:[]},old=library.items.find(i=>itemKey(i)===itemKey(item));if(old)return old;library.items.push(item);tx.objectStore('collections').put(library);return item;});}
 async create(name){name=name.trim();if(!name||name.length>120)throw Error('Use a collection name of at most 120 characters.');return this.edit(async tx=>{const rows=await read(tx.objectStore('collections').getAll()),row={id:crypto.randomUUID(),name,items:[],order:Math.max(-1,...rows.filter(c=>c.id!==LIBRARY).map(c=>c.order??0))+1,createdAt:Date.now()};tx.objectStore('collections').add(row);return row;});}
 async update(id,action){if(id===LIBRARY)throw Error('The library is managed through saved items.');return this.edit(async tx=>{const row=await read(tx.objectStore('collections').get(id));if(!row)throw Error('COLLECTION_REMOVED');const library=await read(tx.objectStore('collections').get(LIBRARY));await action(row,library?.items??[]);tx.objectStore('collections').put(row);return row;});}
 add(id,itemId){return this.update(id,(row,items)=>{const item=items.find(i=>i.id===itemId);if(!item)throw Error('LIBRARY_ITEM_REMOVED');if(!row.items.some(i=>i.id===itemId))row.items.push(item);});}
 remove(id,itemId){return this.update(id,row=>{row.items=row.items.filter(i=>i.id!==itemId);});}
 reorder(id,ids){return this.update(id,row=>{if(ids.length!==row.items.length||new Set(ids).size!==ids.length||ids.some(id=>!row.items.some(i=>i.id===id)))throw Error('COLLECTION_ORDER_CHANGED');row.items=ids.map(id=>row.items.find(i=>i.id===id));});}
 async order(ids){return this.edit(async tx=>{const rows=(await read(tx.objectStore('collections').getAll())).filter(c=>c.id!==LIBRARY);if(ids.length!==rows.length||new Set(ids).size!==ids.length||ids.some(id=>!rows.some(c=>c.id===id)))throw Error('COLLECTION_ORDER_CHANGED');for(const [order,id]of ids.entries())tx.objectStore('collections').put({...rows.find(c=>c.id===id),order});});}
 async forget(itemId){return this.edit(async tx=>{for(const row of await read(tx.objectStore('collections').getAll()))tx.objectStore('collections').put({...row,items:row.items.filter(i=>i.id!==itemId)});});}
 async delete(id){if(id===LIBRARY)throw Error('Delete individual library items instead.');return this.store.deleteCollection(id);}
 async open(item){const doc=await this.store.getDocument(item.docId,item.version);return {doc,scope:validateItem(item,doc)};}
}
