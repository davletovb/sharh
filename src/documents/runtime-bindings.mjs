import contract from '../../config/seatline-contract.json' with {type:'json'};
import {SESSION_HANDLE,CLEANUP_GROUP} from '../paths/limits.mjs';
export const sessionHandles = row => [...new Set([row.session?.handle,row.sessionToken,...(row.sessionHandles??[])].filter(h=>typeof h==='string' && SESSION_HANDLE.test(h)))];
export function queueMaintenance(tx,row) {
  const intent={...row,revision:crypto.randomUUID()};
  tx.objectStore('maintenance').put(intent);return intent;
}
export function queueBindings(tx,row) {
  const target=row.target??row,handles=sessionHandles(row),group=row.cleanupGroup;
  if(target.path!=='seatline' || !contract.providers.includes(target.provider))return {handles:[],groups:[]};
  for(const handle of handles)queueMaintenance(tx,{id:`forget:${target.provider}:${handle}`,method:'forget',provider:target.provider,handle});
  const groups=typeof group==='string' && CLEANUP_GROUP.test(group)?[group]:[];
  for(const value of groups)queueMaintenance(tx,{id:`cleanup:${target.provider}:${value}`,method:'cleanup',provider:target.provider,group:value});
  return {handles:handles.map(handle=>({provider:target.provider,handle})),groups:groups.map(group=>({provider:target.provider,group}))};
}
