import {customDefinition} from '../analysis/contract.mjs';
let pending=Promise.resolve();
export class CustomLenses {
  constructor(storage){this.storage=storage;}
  async list(){const data=(await this.storage.get('sharhCustomLenses')).sharhCustomLenses??[];if(!Array.isArray(data)||data.length>30)throw Error('INVALID_CUSTOM_LENSES');return data.map(customDefinition);}
  mutate(action){if(globalThis.navigator?.locks)return navigator.locks.request('sharh:custom-lenses',action);const operation=pending.then(action);pending=operation.catch(()=>{});return operation;}
  save(value){const definition=customDefinition(value);return this.mutate(async()=>{const all=await this.list(),next=all.filter(d=>d.id!==definition.id).concat(definition);if(next.length>30)throw Error('At most 30 custom lenses can be saved.');await this.storage.set({sharhCustomLenses:next});return definition;});}
  remove(id){return this.mutate(async()=>{await this.storage.set({sharhCustomLenses:(await this.list()).filter(d=>d.id!==id)});});}
  async import(text){if(typeof text!=='string'||text.length>100000)throw Error('CUSTOM_LENS_FILE_TOO_LARGE');const data=JSON.parse(text);if(data.format!=='sharh-lens')throw Error('INVALID_CUSTOM_LENS_FILE');return this.save(data.lens);}
  export(value){return JSON.stringify({format:'sharh-lens',lens:customDefinition(value)},null,2);}
}
