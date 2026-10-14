import {watchPanelContext} from './panel-context.mjs';
import {bindRuns} from './runs.mjs';
import {PathClient} from './client.mjs';
import {diagnostic} from '../../src/paths/diagnostics.mjs';
import {readerURL,isPDFAddress,hasSourceAccess} from '../lib/opening.mjs';
import {enablePassages,passageKey} from '../lib/passages.mjs';
import {createDocument} from '../../src/documents/model.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {createAnalysisEngine} from './analysis.mjs';
import {createWorkspace} from './workspace.mjs';
import {bindScopePicker} from './scope-picker.mjs';
import {scopeControls} from './scope-controls.mjs';
const $=id=>document.getElementById(id),client=new PathClient(),store=await openDocumentStore(),{engine}=createAnalysisEngine(store);
const {id:windowId}=await chrome.windows.getCurrent();const contextKey=`sharh:panel-context:${windowId}`;
let sourceTab=null,current=null,workspace,lastSelection=null;
const fail=error=>{$('read-state').textContent=error.hint??error.message;};
async function sourceMessage(operation,params={}) {
  if(sourceTab===null)throw Error('Open the saved document in the reader to inspect its paragraphs.');
  await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['content/reader.mjs']});
  const tab=await chrome.tabs.get(sourceTab);
  if(tab.url?.split('#')[0]!==current?.address?.split('#')[0])throw Error('The source tab changed. Read the page again.');
  const response=await chrome.tabs.sendMessage(sourceTab,{type:`sharh:reader:${operation}`,...params},{frameId:0});if(response?.error)throw Error(response.error);return response?.result;
}
const controls=scopeControls();$('panel-scope').append(controls);
const picker=bindScopePicker(controls,{selection:async()=>{try{return await sourceMessage('selection',{version:current.version}) || lastSelection;}catch{return lastSelection;}},
  onChange:scope=>workspace?.setScope(scope),measure:(doc,scope)=>workspace?.measureScope(doc,scope),onChapterLevel:()=>store.saveDocument(current).catch(fail)});
async function showDocument(doc,{tabId=null,selection=null}={}) {
  current=doc;sourceTab=tabId;lastSelection=selection;
  await workspace.setDocument(doc);await picker.setDocument(doc);
  $('enable-passages').hidden=sourceTab===null || !doc.address || await hasSourceAccess(chrome,doc.address);
  await chrome.storage.session.set({[contextKey]:{docId:doc.id,version:doc.version,sourceTab}});
}
workspace=await createWorkspace($('analysis-workspace'),{store,engine,client,onControlsChanged:()=>{if(current)picker.refresh();},
  onOpenDocument:async id=>{const doc=await store.getDocument(id);if(doc)await showDocument(doc);},
  onReference:async(block,source)=> {
    if(sourceTab!==null && source.id===current.id && source.version===current.version){try{const hit=await sourceMessage('highlight',{anchor:block.anchor});$('read-state').textContent=hit?`Highlighted ¶${block.n} in the source page.`:'This paragraph could not be found in the current page.';return;}catch(error){fail(error);}}
    const url=new URL(readerURL(chrome.runtime,{docId:source.id}));url.searchParams.set('version',source.version);url.searchParams.set('paragraph',block.n);await chrome.tabs.create({url:url.href});
  }});
$('open-reader').addEventListener('click',()=>chrome.tabs.create({url:readerURL(chrome.runtime)}));
$('open-current-pdf').addEventListener('click',async()=>{try{const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.url)throw Error('Open a PDF tab first.');await chrome.tabs.create({url:readerURL(chrome.runtime,{source:tab.url})});}catch(error){fail(error);}});
$('read-page').addEventListener('click',async()=> {
  $('read-page').disabled=true;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw Error('Open the page you want to read.');
    if(isPDFAddress(tab.url)){await chrome.tabs.create({url:readerURL(chrome.runtime,{source:tab.url})});return;}
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/reader.mjs']});
    const response=await chrome.tabs.sendMessage(tab.id,{type:'sharh:reader:extract',mode:'article'},{frameId:0});if(response?.error)throw Error(response.error);
    const value=createDocument(response.result.extraction,{kind:'html',identity:response.result.identity,address:response.result.address});await store.saveDocument(value);await showDocument(value,{tabId:tab.id});$('read-state').textContent='Ready. Choose a lens and Analyze.';
  }catch(error){fail(error);}finally{$('read-page').disabled=false;}
});
$('enable-passages').addEventListener('click',()=>{if(current?.address && sourceTab!==null)enablePassages(chrome,current.address,sourceTab).then(()=>{$('enable-passages').hidden=true;$('read-state').textContent='Passage actions enabled for this site. Select text on the page.';}).catch(fail);});
$('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('check').addEventListener('click',async()=>{const status=$('state');status.textContent='Checking…';try{const providers=await client.call('discover',{fresh:true});$('providers').replaceChildren();for(const provider of providers){const p=document.createElement('p');p.textContent=`${provider.label}: ${diagnostic(provider).title}`;$('providers').append(p);}status.textContent='Check complete.';}catch(error){status.textContent=error.message;}});
export const prepare=(trigger,target)=>client.call('prepare',{trigger,target});
export const {run}=bindRuns(client,{state:$('run-state'),retry:$('retry'),stop:$('stop')});
const stopWatching=watchPanelContext(client);window.addEventListener('pagehide',()=>{stopWatching();workspace.dispose();},{once:true});
const key=passageKey(windowId);
async function consumePassage(){
  return navigator.locks.request(key,async()=>{
    const value=(await chrome.storage.session.get(key))[key];if(!value)return;
    // Consume once across panel reopen/reload. A failed action remains in saved run history.
    await chrome.storage.session.remove(key);const doc=await store.getDocument(value.docId,value.version);if(!doc)throw Error('The selected document was deleted.');
    await showDocument(doc,{tabId:value.sourceTab,selection:value.selection});$('scope-kind').value='selection';await picker.refresh();await workspace.passage(value.action,value.selection);
  });
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && changes[key]?.newValue)consumePassage().catch(fail);});
const saved=(await chrome.storage.session.get(contextKey))[contextKey];
if(saved){const doc=await store.getDocument(saved.docId,saved.version);if(doc)await showDocument(doc,{tabId:saved.sourceTab});}
await consumePassage().catch(fail);
