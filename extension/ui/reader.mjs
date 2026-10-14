import {extractHTML} from '../../src/readers/html.mjs';
import {openPDF, extractPDF} from '../../src/readers/pdf.mjs';
import {createDocument,contentHash} from '../../src/documents/model.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {bindScopePicker} from './scope-picker.mjs';
import {PDFView} from './pdf-view.mjs';
import {sourceURL,sourceOrigin,hasSourceAccess} from '../lib/opening.mjs';
const $=id=>document.getElementById(id), store=await openDocumentStore(), params=new URL(location.href).searchParams;
let doc, pdf, sourceTab=params.has('tab') ? Number(params.get('tab')) : null, localHTML, pendingSource, lastSelection=null;
let busy=false;
const pdfView=new PDFView($('pdf-pages'));
const picker=bindScopePicker($('scope-picker'),{selection:async()=> {
  if (pdf) return pdfView.selection() || lastSelection;
  if (sourceTab !== null) return readerMessage('selection',{version:doc.version});
  return blockSelection() || lastSelection;
},onChapterLevel:()=>store.saveDocument(doc).catch(fail)});
const state=text=>{ $('reader-state').textContent=text; };
const fail=error=> {
  const hints={READABILITY_NO_ARTICLE:'No main article was found. Try Whole page or choose a region.',REGION_NOT_FOUND:'No page element matches that region selector.',NO_TEXT_BLOCKS:'No readable text was found in this source.',INVALID_ARCHIVE:'Choose a Sharh documents export file.',INVALID_DOCUMENT:'The document archive has an invalid document.',NO_SELECTION:'Select source text first.'};
  state(hints[error.message] || error.message || String(error));
};
async function operate(action) {
  if (busy) { state('A document is still opening. Wait for it to finish.'); return; }
  busy=true;
  const controls=['read-current','open-file','source-address','allow-source','reextract','import-data','export-data'];
  for (const id of controls) $(id).disabled=true;
  $('open-address').querySelector('button').disabled=true;
  try { await action(); } catch(error) { fail(error); }
  finally {
    busy=false;
    for (const id of controls) $(id).disabled=false;
    $('open-address').querySelector('button').disabled=false;
    $('reextract').disabled=doc?.kind!=='html' || (sourceTab===null && !localHTML);
  }
}
async function readerMessage(operation,values={}) {
  // Recheck permission through injection, including after a site grant is removed.
  await attachReader();
  const tab=await chrome.tabs.get(sourceTab);
  if (operation!=='extract' && doc?.address && tab.url?.split('#')[0]!==doc.address.split('#')[0]) throw Error('The source tab navigated to another document. Read it again.');
  const response=await chrome.tabs.sendMessage(sourceTab,{type:`sharh:reader:${operation}`,...values},{frameId:0});
  if (response?.error) throw Error(response.error);
  return response?.result;
}
async function attachReader() {
  await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['content/reader.mjs']});
}
async function resetPDF() {
  pdfView.clear();
  if (pdf) await pdf.loadingTask.destroy();
  pdf=null;
}
async function showDocument(value) {
  doc=value; lastSelection=null; $('document-title').textContent=doc.title; document.title=`${doc.title} · Sharh`;
  $('document-detail').textContent=`${doc.kind==='pdf' ? `${doc.pageCount} pages · ` : ''}${doc.blocks.length} numbered blocks${doc.language ? ` · ${doc.language}` : ''}`;
  $('reextract').disabled=doc.kind!=='html' || (sourceTab===null && !localHTML);
  $('chrome-viewer').hidden=doc.kind!=='pdf' || !doc.address;
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
  await picker.setDocument(doc); await savedList();
  state(`Saved locally. ${doc.warnings?.length ? `${doc.warnings.length} extraction warning(s).` : 'Choose a scope or a paragraph.'}`);
}
async function readTab(tabId) {
  state('Reading page…');
  sourceTab=tabId; localHTML=null; await resetPDF();
  const tab=await chrome.tabs.get(tabId);
  try { await attachReader(); } catch { pendingSource=tab.url || null; $('allow-source').hidden=!pendingSource; throw Error('Allow access to the source site, or click the Sharh toolbar button on that page. For local files, enable “Allow access to file URLs” in Chrome extension details.'); }
  const result=await readerMessage('extract',{mode:$('html-mode').value,region:$('html-region').value.trim() || null});
  const value=createDocument(result.extraction,{kind:'html',identity:result.identity,address:result.address});
  await store.saveDocument(value); await showDocument(value);
}
async function loadPDFBytes(bytes,{identity,address=null,fileName=null}={}) {
  state('Extracting PDF text…'); await resetPDF(); sourceTab=null; localHTML=null;
  pdf=await openPDF(bytes,{workerSrc:chrome.runtime.getURL('pdf.worker.mjs'),standardFontDataUrl:chrome.runtime.getURL('standard_fonts/'),wasmUrl:chrome.runtime.getURL('wasm/')});
  const extraction=await extractPDF(pdf,identity,{sourceHash:contentHash(new Uint8Array(bytes))});
  if (!extraction.blocks.length) throw Error('This PDF has no extractable text. Scanned PDFs need OCR, which is not available yet.');
  const value=createDocument(extraction,{kind:'pdf',identity,address,fileName});
  await store.saveDocument(value,{bytes:new Uint8Array(bytes),mime:'application/pdf'});
  await showDocument(value); await pdfView.open(pdf,value);
}
async function openPDFAddress(address) {
  const url=sourceURL(address); pendingSource=url.href; $('source-address').value=url.href;
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
    await resetPDF(); sourceTab=null; localHTML={text:await file.text(),name:file.name}; await readLocalHTML();
  } else throw Error('Choose a PDF or HTML file.');
}
async function readLocalHTML() {
  const source=new DOMParser().parseFromString(localHTML.text,'text/html');
  let extraction;
  try { extraction=await extractHTML(source,{mode:$('html-mode').value,region:$('html-region').value.trim() || null,identity:`file:${localHTML.name}`}); }
  catch(error) { if ($('html-mode').value!=='article') throw error; extraction=await extractHTML(source,{mode:'whole',identity:`file:${localHTML.name}`}); extraction.warnings.push({cause:'no-main-article',detail:'Used whole-page extraction.'}); }
  const value=createDocument(extraction,{kind:'html',identity:`file:${localHTML.name}`,fileName:localHTML.name});
  await store.saveDocument(value,{html:localHTML.text,mime:'text/html'}); await showDocument(value);
}
async function jump(block) {
  if (busy) return;
  if (pdf) { const hit=await pdfView.highlight(block.anchor); state(hit ? `Highlighted ¶${block.n} · p. ${block.pageLabel}` : 'This paragraph could not be found.'); return; }
  if (sourceTab!==null) {
    try { await attachReader(); const hit=await readerMessage('highlight',{anchor:block.anchor}); state(hit ? `Highlighted ¶${block.n} in the source page.` : 'This paragraph could not be found in the current page.'); return; }
    catch { state('The source tab is unavailable. Reopen the source page and read it again to jump to this paragraph.'); return; }
  }
  for (const el of $('text-blocks').querySelectorAll('.selected')) el.classList.remove('selected');
  const row=$('text-blocks').querySelector(`[data-n="${block.n}"]`); row.classList.add('selected'); row.scrollIntoView({block:'center'});
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
document.addEventListener('selectionchange',()=> {
  if (!doc) return;
  const selected=pdf ? pdfView.selection() : sourceTab===null ? blockSelection() : null;
  if (selected) lastSelection=selected;
});
async function reopen(id) {
  const value=await store.getDocument(id), source=await store.getSource(id,value.version);
  await resetPDF(); sourceTab=null; localHTML=null;
  if (value.kind==='pdf') {
    if (!source?.bytes) throw Error('The saved PDF file is missing. Open the source again.');
    pdf=await openPDF(source.bytes,{workerSrc:chrome.runtime.getURL('pdf.worker.mjs'),standardFontDataUrl:chrome.runtime.getURL('standard_fonts/'),wasmUrl:chrome.runtime.getURL('wasm/')});
    await showDocument(value); await pdfView.open(pdf,value);
  } else { if (source?.html) localHTML={text:source.html,name:value.fileName}; await showDocument(value); }
}
async function savedList() {
  const rows=await store.listDocuments(); $('saved-documents').replaceChildren();
  for (const item of rows) {
    const row=document.createElement('article'), title=document.createElement('span'), open=document.createElement('button'), remove=document.createElement('button');
    title.className='saved-title'; title.textContent=`${item.title}${item.fileName && item.fileName!==item.title ? ` · ${item.fileName}` : ''}`; open.textContent='Open'; remove.textContent='Delete';
    open.addEventListener('click',()=>operate(()=>reopen(item.id)));
    remove.addEventListener('click',()=>operate(async()=> { await store.deleteDocument(item.id); if(doc?.id===item.id) { await resetPDF(); doc=null; $('scope-picker').hidden=true; $('text-blocks').hidden=true; $('show-text').hidden=true; $('chrome-viewer').hidden=true; $('outline').replaceChildren(); $('document-title').textContent='Open a text'; $('document-detail').textContent='Choose a document.'; } await savedList(); state('Document and its saved data deleted.'); }));
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
  const permission=chrome.permissions.request({origins:[sourceOrigin(pendingSource)]});
  operate(async()=> {
    const granted=await permission;
    if (!granted) throw Error('Source access was not granted.');
    if (sourceTab!==null) await readTab(sourceTab); else await openPDFAddress(pendingSource);
  });
});
$('chrome-viewer').addEventListener('click',()=>chrome.runtime.sendMessage({type:'sharh:chrome-viewer',source:doc.address}).then(response=>{if(response?.error)throw Error(response.error);}).catch(fail));
document.addEventListener('dragover',event=>{ if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); document.body.classList.add('dragover'); } });
document.addEventListener('dragleave',()=>document.body.classList.remove('dragover'));
document.addEventListener('drop',event=>{ event.preventDefault(); document.body.classList.remove('dragover'); const file=event.dataTransfer.files[0]; operate(()=>openFile(file)); });
$('export-data').addEventListener('click',()=>operate(async()=> { const archive=await store.exportData(), url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'})), a=document.createElement('a'); a.href=url; a.download='sharh-documents.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); state('Documents exported.'); }));
$('import-data').addEventListener('change',event=> { const file=event.target.files[0]; operate(async()=> { if(!file)return; const count=await store.importData(JSON.parse(await file.text())); await savedList(); state(`Imported ${count} document(s).`); }).finally(()=>{event.target.value='';}); });
await savedList();
await operate(async()=> {
  if (params.has('source')) { sourceTab=null; await openPDFAddress(params.get('source')); }
  else if (params.has('doc')) await reopen(params.get('doc'));
  else if (sourceTab!==null) await readTab(sourceTab);
});
