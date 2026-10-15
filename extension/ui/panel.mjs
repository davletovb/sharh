import {watchPanelContext} from './panel-context.mjs';
import {PathClient} from './client.mjs';
import {READ_INTENT,readerURL,isPDFAddress,hasSourceAccess,sourceOrigin,recoverableAddress,SOURCE_ACCESS_HINT,SOURCE_STILL_BLOCKED} from '../lib/opening.mjs';
import {enablePassages,passageKey} from '../lib/passages.mjs';
import {createDocument} from '../../src/documents/model.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {ReadingPreferences,usable} from '../../src/ui/preferences.mjs';
import {connectionSteps} from '../../src/ui/connection.mjs';
import {authorizeCommand} from '../../src/paths/diagnostics.mjs';
import {createAnalysisEngine} from './analysis.mjs';
import {createWorkspace} from './workspace.mjs';
import {bindScopePicker} from './scope-picker.mjs';
import {scopeControls} from './scope-controls.mjs';
import {acceptPassage} from './passage-handoff.mjs';
import {brand,icon,iconButton} from './icons.mjs';
import {menuButton,callout} from './components.mjs';
import {element,button} from './dom.mjs';
const $=id=>document.getElementById(id),client=new PathClient(),store=await openDocumentStore(),{engine}=createAnalysisEngine(store),preferences=new ReadingPreferences(chrome.storage.local);
await preferences.load();document.documentElement.dataset.theme=preferences.value.theme;
try{ownTabId=(await chrome.tabs.getCurrent())?.id??null;}catch{/* The side panel is not a tab. */}
const {id:windowId}=await chrome.windows.getCurrent();const contextKey=`sharh:panel-context:${windowId}`;
let ownTabId=null,anchor=null,earlierId=null,sourceTab=null,current=null,workspace,lastSelection=null,pendingSource=null,connected=null,dismissed=false,activeTab=null;const autoTried=new Set();
chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.type==='sharh:viewport'&&sender.id===chrome.runtime.id&&sender.tab?.id===sourceTab&&sender.frameId===0&&message.version===current?.version&&Array.isArray(message.numbers)&&message.numbers.every(n=>Number.isSafeInteger(n)&&n>0&&n<=current.blocks.length))workspace?.visibleParagraphs(message.numbers,{docId:current.id,version:current.version});});
const say=text=>{$('read-state').textContent=text;};
const fail=error=>say(error.hint??error.message);
const openSettings=(section='connection')=>chrome.tabs.create({url:chrome.runtime.getURL('ui/settings.html#'+section)});

// ───────── Header ─────────
const menu=menuButton({label:'Sharh menu',iconName:'more'});
$('app-header').append(brand(),Object.assign(element('span'),{className:'spread'}),menu.root);
const gear=iconButton('gear','Settings',()=>chrome.runtime.openOptionsPage());gear.id='settings';$('app-header').append(gear);
menu.setItems(()=>[
  ...(current&&workspace?[...workspace.menuItems(),'-']:[]),
  {label:'Read the page in this tab',action:()=>readActive()},
  {label:'Open a PDF or file…',action:()=>chrome.tabs.create({url:readerURL(chrome.runtime)})},
  {label:'Close this reading',action:()=>closeDocument(),get hidden(){return !current;}},
  '-',
  {label:'Open Sharh in a full tab',action:()=>chrome.tabs.create({url:readerURL(chrome.runtime,current?{docId:current.id}:{})}),get hidden(){return !!current;}},
  {label:'Settings',action:()=>chrome.runtime.openOptionsPage()}
]);
$('connect-art').replaceWith(icon('star',{size:44,className:'art'}));
$('consent-art').replaceWith(icon('star',{size:44,className:'art'}));

// ───────── What is on screen ─────────
function render() {
  const hasDocument=!!current;
  $('state-reading').hidden=!hasDocument;
  $('state-connect').hidden=hasDocument||connected!==false;
  $('state-consent').hidden=hasDocument||connected===false;
  $('recents').hidden=hasDocument;
  $('state-consent').classList.toggle('compact',dismissed);
  renderTab();
}
function renderTab() {
  const url=activeTab?.url??null,pdf=!!url&&isPDFAddress(url);
  let host=null,readable=true;
  if(url){try{const parsed=new URL(url);readable=['http:','https:','file:'].includes(parsed.protocol);host=parsed.hostname||'A file on this computer.';}catch{readable=false;}}
  $('open-current-pdf').hidden=!pdf;$('read-page').hidden=pdf||!readable;
  $('h-consent').textContent=pdf?'This tab is a PDF':readable?'Read this page?':'This page can’t be read';
  $('consent-page').textContent=!readable?'Open a web page or a PDF in this tab, or open a saved reading below.':activeTab?.title?`${activeTab.title} · ${host??'The page in this tab.'}`:host??'The page in this tab.';
  document.querySelector('.consent-note').hidden=!readable||pdf;
}
const stripHash=value=>value?String(value).split('#')[0]:null;
// The panel follows the tab you are looking at. A reading belongs to the page it came from; once you
// move to another tab, or the page itself moves on, the panel asks about the page in front of you instead.
function leftReading(tab) {
  if(!tab||!anchor)return false;
  if(anchor.tabId===null){anchor={tabId:tab.id,url:stripHash(tab.url)};return false;}
  if(tab.id!==anchor.tabId)return true;
  const url=stripHash(tab.url);return !!(url&&anchor.url&&url!==anchor.url);
}
async function refreshTab() {
  let tab=null;
  try{[tab]=await chrome.tabs.query({active:true,currentWindow:true});}catch{/* No window to ask. */}
  // When this page is itself open as a tab, keep following the page it was reading.
  if(tab&&tab.id===ownTabId)tab=activeTab;
  activeTab=tab??null;
  if(current&&leftReading(activeTab)){
    // Never cut an answer short because someone looked at another tab.
    if(workspace?.active){setTimeout(refreshTab,1500);return;}
    await closeDocument();
  }
  dismissed=false;renderTab();render();await offerEarlier();await maybeAutoRead();
}
// A page that was read before can be reopened without reading it again.
async function offerEarlier() {
  earlierId=null;$('open-earlier').hidden=true;
  if(current||!activeTab?.url)return;
  const url=stripHash(activeTab.url),rows=(await store.listDocuments()).filter(d=>!d.derived&&d.address&&stripHash(d.address)===url).sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0));
  if(rows[0]){earlierId=rows[0].id;$('open-earlier').hidden=false;}
}
// Reading without being asked is a setting, and it never applies to a site Sharh cannot already see.
async function maybeAutoRead() {
  const tab=activeTab;
  // A page that is still loading is read when it finishes, which fires its own update.
  if(!tab?.url||tab.status!=='complete'||current||connected===false||preferences.value.autoRead!=='allowed'||isPDFAddress(tab.url))return;
  const key=tab.id+'|'+tab.url.split('#')[0];if(autoTried.has(key))return;autoTried.add(key);
  try{if(await hasSourceAccess(chrome,tab.url))await readTab(tab);}catch(error){autoTried.delete(key);say(`Sharh could not read this page automatically. ${error.hint??error.message}`);}
}
async function showRecents() {
  const rows=(await store.listDocuments()).filter(d=>!d.derived).sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0)).slice(0,5),list=$('recent-list');
  list.replaceChildren();
  if(!rows.length)list.append(element('p','Documents you read appear here, and open without any connection.','hint'));
  for(const item of rows){
    const row=button('',async()=>{const doc=await store.getDocument(item.id);if(doc)await showDocument(doc);},'recent');
    row.append(element('strong',item.title),element('span',[item.kind.toUpperCase(),item.updatedAt?new Date(item.updatedAt).toLocaleDateString():null].filter(Boolean).join(' · '),'hint'));
    list.append(row);
  }
}

// ───────── Source access ─────────
async function sourceMessage(operation,params={}) {
  if(sourceTab===null)throw Error('Open the saved document in the full tab to inspect its paragraphs.');
  await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['content/reader.mjs']});
  const tab=await chrome.tabs.get(sourceTab);
  if(tab.url?.split('#')[0]!==current?.address?.split('#')[0])throw Error('The source tab changed. Read the page again.');
  const response=await chrome.tabs.sendMessage(sourceTab,{type:`sharh:reader:${operation}`,...params},{frameId:0});if(response?.error)throw Error(response.error);return response?.result;
}
const controls=scopeControls();
const picker=bindScopePicker(controls,{selection:async()=>{try{return await sourceMessage('selection',{version:current.version}) || lastSelection;}catch{return lastSelection;}},
  onChange:scope=>workspace?.setScope(scope),measure:(doc,scope)=>workspace?.measureScope(doc,scope),onChapterLevel:()=>store.saveDocument(current).catch(fail)});
async function showDocument(doc,{tabId=null,selection=null}={}) {
  current=doc;sourceTab=tabId;lastSelection=selection;
  anchor={tabId:tabId??activeTab?.id??null,url:tabId!==null?stripHash(doc.address):stripHash(activeTab?.url)};
  await workspace.setDocument(doc);await picker.setDocument(doc);
  $('enable-passages-bar').hidden=sourceTab===null || !doc.address || await hasSourceAccess(chrome,doc.address);
  await chrome.storage.session.set({[contextKey]:{docId:doc.id,version:doc.version,sourceTab}});
  render();
}
async function closeDocument() {
  current=null;anchor=null;sourceTab=null;lastSelection=null;dismissed=false;
  await workspace.setDocument(null);picker.clear();await chrome.storage.session.remove(contextKey);
  say('');await showRecents();render();
}
workspace=await createWorkspace($('analysis-workspace'),{store,engine,client,layout:'conversation',onControlsChanged:()=>{if(current)picker.refresh();},
  onOpenDocument:async(id,version,scope)=>{const doc=await store.getDocument(id,version);if(doc){await showDocument(doc);if(scope)await picker.restore(scope);}},
  onReference:async(block,source)=> {
    if(sourceTab!==null && source.id===current.id && source.version===current.version){try{const hit=await sourceMessage('highlight',{anchor:block.anchor});say(hit?`Highlighted ¶${block.n} in the source page.`:'This paragraph could not be found in the current page.');return;}catch(error){fail(error);}}
    const url=new URL(readerURL(chrome.runtime,{docId:source.id}));url.searchParams.set('version',source.version);url.searchParams.set('paragraph',block.n);await chrome.tabs.create({url:url.href});
  }});
workspace.scopeHost.append(controls);
$('open-reader').addEventListener('click',()=>chrome.tabs.create({url:readerURL(chrome.runtime)}));
$('open-current-pdf').addEventListener('click',async()=>{try{const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.url)throw Error('Open a PDF tab first.');await chrome.tabs.create({url:readerURL(chrome.runtime,{source:tab.url})});}catch(error){fail(error);}});
async function readTab(tab,{recovering=false}={}) {
  if(isPDFAddress(tab.url)){await chrome.tabs.create({url:readerURL(chrome.runtime,{source:tab.url})});return;}
  try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/reader.mjs']});}
  catch{const address=recovering?null:recoverableAddress(tab.url,current?.address);pendingSource=address?{tabId:tab.id,address}:null;$('allow-source').hidden=!pendingSource;throw Error(recovering?SOURCE_STILL_BLOCKED:SOURCE_ACCESS_HINT);}
  const response=await chrome.tabs.sendMessage(tab.id,{type:'sharh:reader:extract',mode:'article'},{frameId:0});if(response?.error)throw Error(response.error);
  const value=createDocument(response.result.extraction,{kind:'html',identity:response.result.identity,address:response.result.address});await store.saveDocument(value);await showDocument(value,{tabId:tab.id});
  pendingSource=null;$('allow-source').hidden=true;say('');
}
async function readActive() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw Error('Open the page you want to read.');
  await readTab(tab);
}
$('read-page').addEventListener('click',async()=> {
  $('read-page').disabled=true;
  try {await readActive();}catch(error){fail(error);}finally{$('read-page').disabled=false;}
});
$('not-now').addEventListener('click',()=>{dismissed=true;render();});
$('open-earlier').addEventListener('click',()=>{(async()=>{const doc=earlierId&&await store.getDocument(earlierId);if(!doc)throw Error('That saved reading could not be found.');await showDocument(doc,{tabId:activeTab?.id??null});say('');})().catch(fail);});
$('allow-source').addEventListener('click',()=>{
  if(!pendingSource)return;const pending=pendingSource;
  // Begin permission recovery in this click's user gesture.
  const permission=chrome.permissions.request({origins:[sourceOrigin(pending.address)]});
  $('allow-source').disabled=true;
  permission.then(async granted=>{if(!granted)throw Error('Source access was not granted. '+SOURCE_ACCESS_HINT);await readTab(await chrome.tabs.get(pending.tabId),{recovering:true});}).catch(fail).finally(()=>{$('allow-source').disabled=false;});
});
$('enable-passages').addEventListener('click',()=>{if(current?.address && sourceTab!==null)enablePassages(chrome,current.address,sourceTab).then(()=>{$('enable-passages-bar').hidden=true;say('Selection tools are on for this site. Select text on the page.');}).catch(fail);});

// ───────── Connection ─────────
const authorize=authorizeCommand(chrome.runtime.id);
{
  const details=element('details'),pre=element('pre',authorize),copy=button('Copy command',async()=>{try{await navigator.clipboard.writeText(authorize);say('Command copied.');}catch{say('Select and copy the command shown.');}});
  pre.id='panel-authorize';details.append(element('summary','Show the authorize command'),pre,copy);$('connect-next').after(details);
}
async function checkConnection({fresh=false}={}) {
  $('state').textContent=fresh?'Checking…':'';
  try{
    const results=await client.call('discover',{fresh}),summary=connectionSteps(results);
    connected=results.some(usable);
    for(const li of document.querySelectorAll('#panel-steps li')){const state=summary.steps[li.dataset.step];if(state==='wait')li.removeAttribute('data-state');else li.dataset.state=state;}
    $('connect-next').textContent=summary.connected?'':summary.next;
    if(fresh)$('state').textContent=connected?'Connected.':'Still not connected.';
  }catch(error){connected=false;$('state').textContent=error.message;}
  render();
}
$('check').addEventListener('click',()=>checkConnection({fresh:true}));
$('open-connection').addEventListener('click',()=>openSettings('connection'));
export const prepare=(trigger,target)=>client.call('prepare',{trigger,target});
const stopWatching=watchPanelContext(client);
// "Read this page" in the right-click menu is itself the request to read.
async function consumeReadIntent(){
  const intent=(await chrome.storage.session.get(READ_INTENT))[READ_INTENT];if(!intent)return;
  await chrome.storage.session.remove(READ_INTENT);
  if(Date.now()-intent.at>30000)return;
  await refreshTab();if(activeTab?.id===intent.tabId&&!current)await readTab(activeTab).catch(fail);
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes[READ_INTENT]?.newValue)consumeReadIntent().catch(fail);});
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((id,change)=>{if(id===activeTab?.id&&(change.status==='complete'||change.url))refreshTab();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.sharhReading){preferences.load().then(v=>{document.documentElement.dataset.theme=v.theme;maybeAutoRead();});checkConnection();}});
window.addEventListener('pagehide',()=>{stopWatching();workspace.dispose();},{once:true});

// ───────── A passage chosen on the page ─────────
const key=passageKey(windowId);
async function consumePassage(){
  return navigator.locks.request(key,async()=>{
    try{await acceptPassage({key,storage:chrome.storage.session,store,engine,isActive:()=>workspace.active,
      show:async(doc,value)=>{await showDocument(doc,{tabId:value.sourceTab,selection:value.selection});$('scope-kind').value='selection';await picker.refresh();},
      onPassage:(...args)=>workspace.passage(...args),onSaved:id=>workspace.openSaved(id),onAsk:id=>workspace.openChat(id)});
      $('retry-passage').hidden=$('dismiss-passage').hidden=true;
    }catch(error){const pending=(await chrome.storage.session.get(key))[key];$('retry-passage').hidden=$('dismiss-passage').hidden=!pending;throw error;}
  });
}
$('retry-passage').addEventListener('click',()=>consumePassage().catch(fail));
$('dismiss-passage').addEventListener('click',()=>{chrome.storage.session.remove(key).then(()=>{$('retry-passage').hidden=$('dismiss-passage').hidden=true;say('Pending passage dismissed.');}).catch(fail);});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && changes[key]?.newValue)consumePassage().catch(fail);});

// ───────── Start ─────────
const saved=(await chrome.storage.session.get(contextKey))[contextKey];
if(saved){const doc=await store.getDocument(saved.docId,saved.version);if(doc)await showDocument(doc,{tabId:saved.sourceTab});}
await showRecents();
render();
await refreshTab();
checkConnection();
await consumePassage().catch(fail);
await consumeReadIntent().catch(fail);
