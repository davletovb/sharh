import {extractHTML} from '../../src/readers/html.mjs';
import {openPDF, extractPDF} from '../../src/readers/pdf.mjs';
import {createDocument,contentHash} from '../../src/documents/model.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {bindScopePicker} from './scope-picker.mjs';
import {ParagraphViewport} from './paragraph-viewport.mjs';
import {PDFView} from './pdf-view.mjs';
import {sourceURL,sourceOrigin,hasSourceAccess,recoverableAddress,SOURCE_ACCESS_HINT,SOURCE_STILL_BLOCKED} from '../lib/opening.mjs';
import {createAnalysisEngine} from './analysis.mjs';
import {PathClient} from './client.mjs';
import {createWorkspace} from './workspace.mjs';
import {installSelectionToolbar} from './passage-toolbar.mjs';
import {brand,iconButton} from './icons.mjs';
import {menuButton} from './components.mjs';
const $=id=>document.getElementById(id), store=await openDocumentStore(), params=new URL(location.href).searchParams;
// E binds lens controls to this page-owned engine; parsing never runs on the worker's native port.
export const {engine:analysisEngine}=createAnalysisEngine(store);
const maintenanceClient=new PathClient();
const initialTab=params.has('tab')?Number(params.get('tab')):null;
const studioKey=params.get('studio'),studioIntent=studioKey?(await chrome.storage.session.get('sharh:studio:'+studioKey))['sharh:studio:'+studioKey]:null;
if(studioIntent){params.set('doc',studioIntent.docId);params.set('version',studioIntent.version);}
let doc, pdf, sourceTab=null, localHTML, pendingSource, viewerSource=null, lastSelection=null;
let busy=false,workspace,workspaceReady;
let pdfView=new PDFView($('pdf-pages'));
const sourceViewport=new ParagraphViewport((numbers,source)=>workspace?.visibleParagraphs(numbers,source));
let itemParagraphs=new Map(),observedPages=new Map();
function observePDFPage(page){
  for(const el of observedPages.get(page)??[])sourceViewport.unobserve(el);observedPages.delete(page);
  const state=pdfView.pages.get(page);if(!pdf||!state?.items)return;
  const observed=[];for(const [item,numbers]of itemParagraphs.get(page)??[]){const el=state.items[item];if(el){sourceViewport.observe(el,numbers);observed.push(el);}}observedPages.set(page,observed);
}
new MutationObserver(changes=>{for(const page of new Set(changes.map(c=>Number(c.target.dataset.page))))observePDFPage(page);}).observe($('pdf-pages'),{subtree:true,attributes:true,attributeFilter:['data-rendered']});
function bindSourceViewport(){
  sourceViewport.reset({docId:doc.id,version:doc.version});observedPages.clear();itemParagraphs=new Map();
  if(pdf){for(const block of doc.blocks){if(!itemParagraphs.has(block.page))itemParagraphs.set(block.page,new Map());const items=itemParagraphs.get(block.page);for(const item of block.anchor.items??[]){if(!items.has(item))items.set(item,[]);items.get(item).push(block.n);}}for(const [page,state]of pdfView.pages)if(state.items)observePDFPage(page);}
  else for(const row of $('text-blocks').children)sourceViewport.observe(row,[Number(row.dataset.n)]);
}
const picker=bindScopePicker($('scope-picker'),{selection:async()=> {
  if (pdf) return pdfView.selection() || lastSelection;
  if (sourceTab !== null) return readerMessage('selection',{version:doc.version});
  return blockSelection() || lastSelection;
},onChapterLevel:()=>store.saveDocument(doc).catch(fail),onChange:scope=>workspace?.setScope(scope),measure:(value,scope)=>workspace?.measureScope(value,scope)});
const state=text=>{ $('reader-state').textContent=text; };
const fail=error=> {
  const hints={READABILITY_NO_ARTICLE:'No main article was found. Try Whole page or choose a region.',REGION_NOT_FOUND:'No page element matches that region selector.',NO_TEXT_BLOCKS:'No readable text was found in this source.',INVALID_ARCHIVE:'Choose a Sharh documents export file.',INVALID_DOCUMENT:'The document archive has an invalid document.',NO_SELECTION:'Select source text first.'};
  state(error.name==='PasswordException'?'This PDF needs a password. Open it in Chrome’s viewer.':hints[error.message] || error.message || String(error));
};
installSelectionToolbar({document,selection:async()=>pdf?pdfView.selection():blockSelection(),
  onAction:async(action,selection)=>{if(workspace.active)throw Error('Stop the current run before starting another.');lastSelection=selection;$('scope-kind').value='selection';await picker.refresh();await workspace.passage(action,selection);},
  onPrepare:()=>maintenanceClient.call('prepare',{trigger:'passage-toolbar',target:workspace.target}).catch(()=>{})});
// A reader with nothing open is a drop zone; once something is open the source bar shrinks to one row.
let framed=null;
function frame() {
  const open=!!doc;
  // Without a document the useful part of the workspace is the library; opening one returns to analysis.
  if(workspace&&framed!==open){workspace.openArea(open?'analyze':'library');framed=open;}
  $('reader-main').dataset.hasDoc=String(open);$('source-bar').classList.toggle('compact',!!doc);
  $('extraction').hidden=doc?.kind!=='html';
}
$('html-mode').addEventListener('change',()=>{$('html-region-label').hidden=$('html-mode').value!=='region';});
const preferredLayout=(()=>{try{return params.get('layout')||localStorage.getItem('sharh:layout')||'conversation';}catch{return 'conversation';}})()==='studio'?'studio':'conversation';
{
  const header=$('app-header'),spacer=document.createElement('span'),menu=menuButton({label:'Sharh menu',iconName:'more'});spacer.className='spread';
  menu.setItems(()=>[...(workspace?workspace.menuItems():[]),'-',{label:'Open a document…',action:()=>{$('source-bar').scrollIntoView({block:'start'});$('open-file').focus();}}]);
  header.append(brand(),spacer,menu.root,iconButton('gear','Settings',()=>chrome.runtime.openOptionsPage()));
}
async function operate(action) {
  await workspaceReady;
  if (busy) { state('A document is still opening. Wait for it to finish.'); return; }
  busy=true;
  const controls=['read-current','open-file','source-address','allow-source','reextract'];
  for (const id of controls) $(id).disabled=true;
  $('open-address').querySelector('button').disabled=true;
  try { await action(); } catch(error) { fail(error); }
  finally {
    busy=false;
    for (const id of controls) $(id).disabled=false;
    $('open-address').querySelector('button').disabled=false;
    $('reextract').disabled=doc?.kind!=='html' || (sourceTab===null && !localHTML);
    frame();
  }
}
async function readerMessage(operation,values={},tabId=sourceTab) {
  const expected=doc;
  // Recheck permission through injection, including after a site grant is removed.
  await attachReader(tabId);
  const tab=await chrome.tabs.get(tabId);
  if(operation!=='extract' && doc!==expected)throw Error('The current document changed.');
  if (operation!=='extract' && expected?.address && tab.url?.split('#')[0]!==expected.address.split('#')[0]) throw Error('The source tab navigated to another document. Read it again.');
  const response=await chrome.tabs.sendMessage(tabId,{type:`sharh:reader:${operation}`,...values},{frameId:0});
  if (response?.error) throw Error(response.error);
  return response?.result;
}
async function attachReader(tabId=sourceTab) {
  await chrome.scripting.executeScript({target:{tabId},files:['content/reader.mjs']});
}
async function resetPDF() {
  pdfView.clear();
  if (pdf) await pdf.loadingTask.destroy();
  pdf=null;
}
function setViewerSource(address) {
  viewerSource=address;$('chrome-viewer').hidden=!address;
}
async function commitDocument(value,{pdf:nextPDF=null,sourceTab:nextTab=null,localHTML:nextHTML=null}={}) {
  let prepared;
  if(nextPDF) {
    prepared=new PDFView(document.createElement('div'));
    try{await prepared.open(nextPDF,value,{observe:false});}catch(error){prepared.clear();throw error;}
  }
  const previousPDF=pdf;
  pdfView.clear();
  if(prepared){$('pdf-pages').replaceChildren(...prepared.container.childNodes);prepared.container=$('pdf-pages');pdfView=prepared;}
  pdf=nextPDF;sourceTab=nextTab;localHTML=nextHTML;
  pendingSource=null;$('allow-source').hidden=true;$('access-help').textContent='';
  setViewerSource(value.kind==='pdf'?value.address:null);
  try{await showDocument(value);}finally{
    if(prepared)prepared.startObserving();
    if(previousPDF && previousPDF!==nextPDF)await previousPDF.loadingTask.destroy().catch(()=>{});
  }
}
async function showDocument(value) {
  $('reference-extraction').hidden=true;$('reference-extraction').replaceChildren();
  doc=value; lastSelection=null; $('document-title').textContent=doc.title; document.title=`${doc.title} · Sharh`;
  $('document-detail').textContent=`${doc.kind==='pdf' ? `${doc.pageCount} pages · ` : ''}${doc.blocks.length} numbered blocks${doc.language ? ` · ${doc.language}` : ''}`;
  $('reextract').disabled=doc.kind!=='html' || (sourceTab===null && !localHTML);
  $('outline').replaceChildren();
  for (const section of doc.sections) {
    const button=document.createElement('button'); button.textContent=`${section.title}${section.firstPage!==undefined ? ` · pp. ${doc.pageLabels[section.firstPage]}–${doc.pageLabels[section.lastPage]}` : ''}`;
    button.addEventListener('click',()=>jump(doc.blocks[section.first-1]).catch(fail)); $('outline').append(button);
  }
  $('text-blocks').replaceChildren();
  // Text-only rendering also makes local HTML inert: scripts, event handlers and source URLs are never inserted.
  for (const block of doc.blocks) {
    const row=document.createElement('div'); row.className='block'; row.dataset.n=block.n; row.dataset.kind=block.kind;
    const link=document.createElement('button'); link.className='paragraph'; link.textContent=`¶${block.n}${block.pageLabel ? ` · p. ${block.pageLabel}` : ''}`;
    link.addEventListener('click',()=>jump(block).catch(fail));
    const text=document.createElement('p'); text.textContent=block.text; text.dir='auto'; text.dataset.text='true';
    row.append(link,text); $('text-blocks').append(row);
  }
  $('text-blocks').hidden=doc.kind==='pdf';
  $('show-text').hidden=doc.kind!=='pdf'; $('show-text').textContent='Show numbered text';
  await workspace.setDocument(doc);await picker.setDocument(doc); await savedList();
  bindSourceViewport();
  state(`Saved locally. ${doc.warnings?.length ? `${doc.warnings.length} extraction warning(s).` : 'Choose a scope or a paragraph.'}`);
}
async function readTab(tabId,{recovering=false}={}) {
  state('Reading page…');
  const tab=await chrome.tabs.get(tabId);
  try { await attachReader(tabId); } catch { const address=recovering?null:recoverableAddress(tab.url,doc?.address); pendingSource=address?{kind:'tab',address,tabId}:null; $('allow-source').hidden=!pendingSource; throw Error(recovering?SOURCE_STILL_BLOCKED:SOURCE_ACCESS_HINT); }
  const result=await readerMessage('extract',{mode:$('html-mode').value,region:$('html-region').value.trim() || null},tabId);
  const value=createDocument(result.extraction,{kind:'html',identity:result.identity,address:result.address});
  await store.saveDocument(value); await commitDocument(value,{sourceTab:tabId});
}
async function loadPDFBytes(bytes,{identity,address=null,fileName=null}={}) {
  state('Extracting PDF text…');
  const candidate=await openPDF(bytes,{workerSrc:chrome.runtime.getURL('pdf.worker.mjs'),standardFontDataUrl:chrome.runtime.getURL('standard_fonts/'),wasmUrl:chrome.runtime.getURL('wasm/')});
  try {
  const extraction=await extractPDF(candidate,identity,{sourceHash:contentHash(new Uint8Array(bytes))});
  if (!extraction.blocks.length) throw Error('This PDF has no extractable text. Scanned PDFs need OCR, which is not available yet.');
  const value=createDocument(extraction,{kind:'pdf',identity,address,fileName});
  await store.saveDocument(value,{bytes:new Uint8Array(bytes),mime:'application/pdf'});
  await commitDocument(value,{pdf:candidate});
  }catch(error){if(pdf!==candidate)await candidate.loadingTask.destroy().catch(()=>{});throw error;}
}
async function openPDFAddress(address) {
  const url=sourceURL(address); pendingSource={kind:'pdf',address:url.href}; $('source-address').value=url.href;
  setViewerSource(url.href);
  if (!await hasSourceAccess(chrome,url.href)) {
    $('allow-source').hidden=false;
    $('access-help').textContent=url.protocol==='file:' ? 'Enable “Allow access to file URLs” in Sharh’s Chrome extension details, then allow file access here.' : `Allow ${url.origin} to fetch this PDF and open .pdf addresses automatically on this site.`;
    state('Source access is needed.'); return;
  }
  $('allow-source').hidden=true; $('access-help').textContent=''; state('Opening PDF…');
  // Fetch redirects manually so a grant for one site never authorizes a different site implicitly.
  const response=await fetch(url.href,{credentials:'include',redirect:'error'});
  if (!response.ok) throw Error(`The PDF could not be opened (HTTP ${response.status}).`);
  await loadPDFBytes(await response.arrayBuffer(),{identity:url.href,address:url.href});
}
async function openFile(file) {
  if (!file) return;
  if (/\.pdf$/i.test(file.name) || file.type==='application/pdf') {
    // Name + content hash in the extraction distinguishes same-name local files.
    const bytes=new Uint8Array(await file.arrayBuffer());
    await loadPDFBytes(bytes,{identity:`file:${file.name}:${contentHash(bytes)}`,fileName:file.name});
  } else if (/\.html?$/i.test(file.name) || file.type==='text/html') {
    const text=await file.text();
    await readLocalHTML({text,name:file.name,identity:`file:${file.name}:${contentHash(new TextEncoder().encode(text))}`});
  } else throw Error('Choose a PDF or HTML file.');
}
async function readLocalHTML(candidate=localHTML) {
  const source=new DOMParser().parseFromString(candidate.text,'text/html'), identity=candidate.identity;
  let extraction;
  extraction=await extractHTML(source,{mode:$('html-mode').value,region:$('html-region').value.trim() || null,identity});
  const value=createDocument(extraction,{kind:'html',identity,fileName:candidate.name});
  await store.saveDocument(value,{html:candidate.text,mime:'text/html'}); await commitDocument(value,{localHTML:candidate});
}
async function jump(block) {
  if (busy) return;
  const expected=doc,show=message=>{if(doc===expected)state(message);};
  try {
  if (pdf) { const hit=await pdfView.highlight(block.anchor); show(hit ? `Highlighted ¶${block.n} · p. ${block.pageLabel}` : 'This paragraph could not be found.'); return; }
  if (sourceTab!==null) {
    try { const hit=await readerMessage('highlight',{anchor:block.anchor}); show(hit ? `Highlighted ¶${block.n} in the source page.` : 'This paragraph could not be found in the current page.'); return; }
    catch { show('The source tab is unavailable. Reopen the source page and read it again to jump to this paragraph.'); return; }
  }
  for (const el of $('text-blocks').querySelectorAll('.selected')) el.classList.remove('selected');
  const row=$('text-blocks').querySelector(`[data-n="${block.n}"]`); row.classList.add('selected'); row.scrollIntoView({block:'center'});show(`Highlighted ¶${block.n} in the saved text.`);
  }catch(error){if(doc===expected)throw error;}
}
async function reference(block,source) {
  if(source.id===doc?.id && source.version===doc?.version){$('reference-extraction').hidden=true;await jump(block);return;}
  // A historical reference belongs to its saved extraction, not the live reader.
  // Keep its run, comparison, PDF view and source-tab connection in place.
  const excerpt=$('reference-extraction'),heading=document.createElement('h2'),detail=document.createElement('p'),text=document.createElement('blockquote');
  heading.textContent=`Saved paragraph ¶${block.n}${block.pageLabel?' · p. '+block.pageLabel:''}`;
  detail.textContent=`${source.title} · saved extraction`;text.textContent=block.text;text.dir='auto';text.className='block selected';
  excerpt.replaceChildren(heading,detail,text);excerpt.hidden=false;excerpt.scrollIntoView({block:'center'});state(`Showing ¶${block.n} from its saved extraction.`);
}
function blockSelection() {
  const selected=getSelection(); if (!selected?.rangeCount || selected.isCollapsed) return null;
  const range=selected.getRangeAt(0), spans=[];
  for (const row of $('text-blocks').querySelectorAll('.block')) {
    const p=row.querySelector('[data-text]'), node=p.firstChild;
    if (!node || !range.intersectsNode(node)) continue;
    const n=Number(row.dataset.n), start=range.startContainer===node ? range.startOffset : 0, end=range.endContainer===node ? range.endOffset : node.length;
    if (end>start) spans.push({n,start,end});
  }
  return spans.length ? {spans} : null;
}
function rememberSelection() {
  if (!doc) return;
  const selected=pdf ? pdfView.selection() : sourceTab===null ? blockSelection() : null;
  if (selected) lastSelection=selected;
}
document.addEventListener('pointerup',rememberSelection);
document.addEventListener('keyup',rememberSelection);
document.addEventListener('pointerdown',event=>{if(event.target.closest('button,input,select'))rememberSelection();},true);
async function reopen(id,version) {
  const value=await store.getDocument(id,version);
  if(!value)throw Error('This saved document could not be found. Open its source again.');
  const source=await store.getSource(id,value.version);
  if (value.kind==='pdf') {
    if (!source?.bytes) throw Error('The saved PDF file is missing. Open the source again.');
    const candidate=await openPDF(source.bytes,{workerSrc:chrome.runtime.getURL('pdf.worker.mjs'),standardFontDataUrl:chrome.runtime.getURL('standard_fonts/'),wasmUrl:chrome.runtime.getURL('wasm/')});
    try{await commitDocument(value,{pdf:candidate});}catch(error){if(pdf!==candidate)await candidate.loadingTask.destroy().catch(()=>{});throw error;}
  } else await commitDocument(value,{localHTML:source?.html?{text:source.html,name:value.fileName,identity:value.identity}:null});
}
async function savedList() {
  const rows=await store.listDocuments(); $('saved-documents').replaceChildren();$('saved-section').hidden=!rows.length;
  for (const item of rows) {
    const row=document.createElement('article'), title=document.createElement('span'), open=document.createElement('button'), remove=document.createElement('button');
    title.className='saved-title'; title.textContent=`${item.title}${item.fileName && item.fileName!==item.title ? ` · ${item.fileName}` : ''}`; open.textContent='Open'; remove.textContent='Delete';
    open.addEventListener('click',()=>operate(()=>reopen(item.id)));
    remove.addEventListener('click',()=>operate(async()=> { await store.deleteDocument(item.id); maintenanceClient.call('maintenance').catch(()=>{}); if(doc?.id===item.id) { await resetPDF(); doc=null; await workspace.setDocument(null);picker.clear(); $('text-blocks').hidden=true; $('show-text').hidden=true; $('chrome-viewer').hidden=true; $('outline').replaceChildren(); $('document-title').textContent='Open a text'; $('document-detail').textContent='Choose a document.'; } await savedList(); state('Document and its saved data deleted.'); }));
    row.append(title,open,remove); $('saved-documents').append(row);
  }
}
$('read-current').addEventListener('click',()=>operate(async()=> {
    const tabs=await chrome.tabs.query({lastFocusedWindow:true});
    const current=tabs.find(t=>t.active && !t.url?.startsWith(chrome.runtime.getURL(''))) || tabs.filter(t=>!t.url?.startsWith(chrome.runtime.getURL(''))).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
    if (!current) throw Error('Open a web page and use Read current page from the Sharh panel.');
    await readTab(current.id);
}));
$('reextract').addEventListener('click',()=>operate(()=>localHTML ? readLocalHTML() : readTab(sourceTab)));
$('show-text').addEventListener('click',()=> { $('text-blocks').hidden=!$('text-blocks').hidden; $('show-text').textContent=$('text-blocks').hidden ? 'Show numbered text' : 'Hide numbered text'; });
$('open-file').addEventListener('change',event=>{const file=event.target.files[0];operate(()=>openFile(file));});
$('open-address').addEventListener('submit',event=>{ event.preventDefault(); operate(()=>openPDFAddress($('source-address').value)); });
$('allow-source').addEventListener('click',()=> {
  if (!pendingSource) return;
  // permissions.request must begin directly in the user gesture.
  const pending=pendingSource, permission=chrome.permissions.request({origins:[sourceOrigin(pending.address)]});
  operate(async()=> {
    const granted=await permission;
    if (!granted) throw Error('Source access was not granted.');
    if (pending.kind==='tab') await readTab(pending.tabId,{recovering:true}); else await openPDFAddress(pending.address);
  });
});
$('chrome-viewer').addEventListener('click',()=>chrome.runtime.sendMessage({type:'sharh:chrome-viewer',source:viewerSource}).then(response=>{if(response?.error)throw Error(response.error);}).catch(fail));
document.addEventListener('dragover',event=>{ if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); document.body.classList.add('dragover'); } });
document.addEventListener('dragleave',()=>document.body.classList.remove('dragover'));
document.addEventListener('drop',event=>{ event.preventDefault(); document.body.classList.remove('dragover'); const file=event.dataTransfer.files[0]; operate(()=>openFile(file)); });
// Register source controls before asynchronous workspace/preferences initialization.
// A file chosen during startup waits for the workspace rather than losing its change event.
workspaceReady=createWorkspace($('analysis-workspace'),{store,engine:analysisEngine,client:maintenanceClient,surface:'tab',layout:preferredLayout,onLayout:value=>{try{localStorage.setItem('sharh:layout',value);}catch{/* A remembered view is a convenience. */}},
  onReference:reference,
  onOpenDocument:(id,version,scope)=>operate(async()=>{await reopen(id,version);if(scope)await picker.restore(scope);}),onControlsChanged:()=>{if(doc)picker.refresh();}}).then(value=>{workspace=value;workspace.scopeHost.append($('scope-picker'));});
await workspaceReady;
await savedList();
await operate(async()=> {
  if (params.has('source')) await openPDFAddress(params.get('source'));
  else if (params.has('doc')) await reopen(params.get('doc'),params.get('version')||undefined);
  else if (initialTab!==null) await readTab(initialTab);
});
// The initial open releases operate()'s busy guard before following a deep link.
if(params.has('doc') && params.has('paragraph') && doc){const block=doc.blocks[Number(params.get('paragraph'))-1];if(block)await jump(block).catch(fail);else state('This paragraph is not in the saved extraction.');}
if(studioIntent){if(studioIntent.scope?.version===doc?.version)await picker.restore(studioIntent.scope).catch(fail);await workspace.restoreStudio(studioIntent).catch(fail);}
