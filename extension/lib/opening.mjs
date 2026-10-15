export const SOURCE_ACCESS_HINT='Allow access to the source site, or click the Sharh toolbar button on that page. For local files, enable “Allow access to file URLs” in Chrome extension details.';
export function sourceURL(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Enter an HTTP, HTTPS or file address.'); }
  if (!['http:','https:','file:'].includes(url.protocol) || url.username || url.password) throw Error('Enter an HTTP, HTTPS or file address without credentials.');
  return url;
}
export function isPDFAddress(value) {
  try { return /\.pdf$/i.test(decodeURIComponent(sourceURL(value).pathname)); } catch { return false; }
}
export function sourceOrigin(value) {
  const url = sourceURL(value);
  return url.protocol === 'file:' ? 'file:///*' : `${url.origin}/*`;
}
export const SOURCE_STILL_BLOCKED='Sharh still cannot read this tab. If it is on a different site, click the Sharh toolbar button on that page.';
// Chrome hides a tab's address once Sharh loses access to it, so a recovery can
// only offer the tab's own address or else the site of the document being read.
export function recoverableAddress(tabAddress, documentAddress) {
  const address = tabAddress ?? documentAddress;
  try { if (address) { sourceOrigin(address); return address; } } catch { /* Not an HTTP, HTTPS or file address. */ }
  return null;
}
export function readerURL(runtime, {source, tabId, docId} = {}) {
  const url = new URL(runtime.getURL('ui/reader.html'));
  if (source) url.searchParams.set('source',sourceURL(source).href);
  if (Number.isInteger(tabId)) url.searchParams.set('tab',tabId);
  if (docId) url.searchParams.set('doc',docId);
  return url.href;
}
export async function hasSourceAccess(chrome, value) {
  const url = sourceURL(value);
  if (url.protocol === 'file:' && !await chrome.extension.isAllowedFileSchemeAccess()) return false;
  return chrome.permissions.contains({origins:[sourceOrigin(value)]});
}
export async function openCurrentPDF(chrome, tab, source = tab?.url) {
  if (!Number.isInteger(tab?.id)) throw Error('Open the PDF in a browser tab first.');
  sourceURL(source); // Explicit opening also supports PDF endpoints without a .pdf suffix.
  return chrome.tabs.update(tab.id, {url:readerURL(chrome.runtime,{source,tabId:tab.id})});
}
export const READ_INTENT = 'sharh:read-intent';
export function installOpening(chrome) {
  const pending = new Set(), bypass = new Map(), navigation=new Map(), queues=new Map();
  const key=tabId=>`sharh:reader-navigation:${tabId}`;
  async function navigationFor(tabId) {
    if(!navigation.has(tabId)) {
      const saved=await chrome.storage.session?.get(key(tabId));
      navigation.set(tabId,saved?.[key(tabId)] || {sources:[],fromReader:false});
    }
    return navigation.get(tabId);
  }
  async function saveNavigation(tabId,state) {
    navigation.set(tabId,state);
    await chrome.storage.session?.set({[key(tabId)]:state}).catch(()=>{});
  }
  const maybeOpen = async (tabId, change, tab) => {
    const url = change.url || tab.url;
    if(!url)return;
    const history=await navigationFor(tabId);
    if(url.startsWith(chrome.runtime.getURL('ui/reader.html'))) {
      history.fromReader=true;await saveNavigation(tabId,history);return;
    }
    if(history.fromReader) {
      history.fromReader=false;
      if(isPDFAddress(url) && !history.sources.includes(url))history.sources.push(url);
      await saveNavigation(tabId,history);
      // Back/forward and explicit reader exits must not hand the same navigation back to Sharh.
      if(isPDFAddress(url))return;
    }
    if (bypass.get(tabId) === url) return;
    if (bypass.has(tabId)) bypass.delete(tabId);
    if (!isPDFAddress(url) || pending.has(tabId) || history.sources.includes(url)) return;
    pending.add(tabId);
    try {
      const {pdfAutoOpen = true} = await chrome.storage.local.get('pdfAutoOpen');
      if (!pdfAutoOpen || !await hasSourceAccess(chrome,url)) return;
      // Do not redirect a tab that navigated while permissions/settings were being checked.
      const latest = await chrome.tabs.get(tabId);
      if (latest.url === url || latest.pendingUrl === url) {
        history.sources.push(url);history.sources=history.sources.slice(-128);history.fromReader=true;
        await saveNavigation(tabId,history);
        await openCurrentPDF(chrome,latest,url);
      }
    } catch { /* A closed/inaccessible tab stays in Chrome's viewer. */ }
    finally { pending.delete(tabId); }
  };
  chrome.tabs.onUpdated.addListener((...args)=> {
    const id=args[0],job=(queues.get(id)||Promise.resolve()).then(()=>maybeOpen(...args)).catch(()=>{});
    queues.set(id,job);return job.finally(()=>{if(queues.get(id)===job)queues.delete(id);});
  });
  chrome.tabs.onRemoved.addListener(tabId => { bypass.delete(tabId); pending.delete(tabId);navigation.delete(tabId);chrome.storage.session?.remove(key(tabId)).catch(()=>{}); });
  chrome.action.onClicked.addListener(tab => {
    if (isPDFAddress(tab.url)) openCurrentPDF(chrome,tab).catch(() => {});
    else chrome.sidePanel.open({tabId:tab.id}).catch(() => {});
  });
  chrome.contextMenus.onClicked.addListener((info,tab) => {
    if (info.menuItemId === 'sharh-open-pdf') openCurrentPDF(chrome,tab,info.linkUrl || info.pageUrl || tab.url).catch(() => {});
    if (info.menuItemId === 'sharh-read-page' && Number.isInteger(tab?.id)) {
      // Choosing this menu item is the request to read, so the panel does not ask again.
      chrome.sidePanel.open({tabId:tab.id}).catch(() => {});
      chrome.storage.session?.set({[READ_INTENT]:{tabId:tab.id,at:Date.now()}}).catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || message?.type !== 'sharh:chrome-viewer') return;
    (async () => {
      const url = sourceURL(message.source).href, tabId = sender.tab?.id;
      if (!Number.isInteger(tabId)) throw Error('Open the reader in a tab.');
      // Returning to Chrome is an explicit action; disabling auto-open persists across worker restarts.
      await chrome.storage.local.set({pdfAutoOpen:false}); bypass.set(tabId,url);
      await chrome.tabs.update(tabId,{url});
      return true;
    })().then(result => reply({result}), error => reply({error:error.message}));
    return true;
  });
}
export async function createReaderMenus(chrome) {
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false});
  await chrome.contextMenus.removeAll();
  const documentUrlPatterns=['http://*/*','https://*/*','file:///*'];
  chrome.contextMenus.create({id:'sharh',title:'Sharh',contexts:['page','selection','link'],documentUrlPatterns});
  chrome.contextMenus.create({id:'sharh-read-page',parentId:'sharh',title:'Read this page',contexts:['page','selection'],documentUrlPatterns});
  chrome.contextMenus.create({id:'sharh-open-pdf',parentId:'sharh',title:'Open this PDF in Sharh',contexts:['page','link'],documentUrlPatterns});
}
