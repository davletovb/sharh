import {hasSourceAccess,isPDFAddress,sourceOrigin} from './opening.mjs';
import {createDocument} from '../../src/documents/model.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {buildScope} from '../../src/documents/scopes.mjs';
export const passageKey = windowId => `sharh:passage:${windowId}`;
const actions=new Set(['Explain','Translate','Logic','Define']);
export function installPassages(chrome,{prepare=()=>{}}={}) {
  const store=openDocumentStore();
  async function inject(tab) {
    if(!tab?.url || isPDFAddress(tab.url) || !await hasSourceAccess(chrome,tab.url))return;
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/reader.mjs']});
  }
  chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete')inject(tab).catch(()=>{});});
  chrome.permissions.onAdded.addListener(()=>{chrome.tabs.query({}).then(tabs=>Promise.allSettled(tabs.map(inject))).catch(()=>{});});
  chrome.permissions.onRemoved.addListener(()=>{chrome.tabs.query({}).then(tabs=>Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'sharh:reader:passages-off'},{frameId:0})))).catch(()=>{});});
  chrome.runtime.onMessage.addListener((message,sender,reply)=> {
    if(sender.id!==chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId!==0 || !message?.type?.startsWith('sharh:passage:'))return;
    if(!['sharh:passage:enabled','sharh:passage:invoke','sharh:passage:prepare'].includes(message.type))return;
    if(!/^https?:|^file:/.test(sender.url??''))return;
    // Begin opening directly in the content-script button's user gesture.
    const opening=message.type==='sharh:passage:invoke' && actions.has(message.action)?chrome.sidePanel.open({tabId:sender.tab.id}):null;
    opening?.catch(()=>{});
    (async()=> {
      const allowed=await hasSourceAccess(chrome,sender.url);if(message.type==='sharh:passage:enabled')return allowed;
      if(!allowed)throw Error('Enable passage actions for this site in Sharh.');
      if(message.type==='sharh:passage:prepare'){await prepare();return true;}
      if(!actions.has(message.action) || !opening)throw Error('Unknown passage action.');
      await opening;const current=await chrome.tabs.get(sender.tab.id);
      if(current.url?.split('#')[0]!==sender.url.split('#')[0])throw Error('The source page changed. Select the passage again.');
      const key=passageKey(sender.tab.windowId);return navigator.locks.request(key+':queue',async()=>{if((await chrome.storage.session.get(key))[key])throw Error('A passage is waiting in Sharh. Finish it before choosing another.');
      const doc=createDocument(message.extraction,{kind:'html',identity:sender.url,address:sender.url});
      buildScope(doc,{kind:'selection',spans:message.selection?.spans});await (await store).saveDocument(doc,undefined,{makeCurrent:false});
      await chrome.storage.session.set({[key]:{id:crypto.randomUUID(),docId:doc.id,version:doc.version,sourceTab:sender.tab.id,windowId:sender.tab.windowId,selection:message.selection,action:message.action}});
      return true;});
    })().then(result=>reply({result}),error=>reply({error:error.message}));return true;
  });
  return {inject};
}
export async function enablePassages(chrome,address,tabId) {
  const granted=await chrome.permissions.request({origins:[sourceOrigin(address)]});if(!granted)throw Error('Site access was not granted.');
  await chrome.scripting.executeScript({target:{tabId},files:['content/reader.mjs']});return true;
}
