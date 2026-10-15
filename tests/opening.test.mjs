import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderMenus,READ_INTENT,sourceURL,sourceOrigin,isPDFAddress,readerURL,installOpening,hasSourceAccess,recoverableAddress} from '../extension/lib/opening.mjs';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
test('PDF addressing is URL-aware and only permits web/file sources',()=> {
  for(const url of ['https://example.org/paper.PDF?q=one#page=2','file:///tmp/my%20book.pdf','https://example.org/a%2Epdf']) assert.equal(isPDFAddress(url),true);
  for(const url of ['https://example.org/pdf?name=x.pdf','javascript:foo.pdf','chrome://x.pdf','https://user:pass@example.org/a.pdf','https://example.org/foo.pdf/']) assert.equal(isPDFAddress(url),false);
  assert.throws(()=>sourceURL('data:text/html,x'));
  assert.equal(sourceOrigin('file:///tmp/book.pdf'),'file:///*');
  assert.equal(sourceOrigin('http://localhost:1234/a.pdf'),'http://localhost:1234/*');
  const url=new URL(readerURL({getURL:p=>`chrome-extension://test/${p}`},{source:'https://example.org/a.pdf?a=1&b=2',tabId:2}));
  assert.equal(url.searchParams.get('source'),'https://example.org/a.pdf?a=1&b=2');
});
test('source recovery uses the tab address, else the document being read, and never an unusable address',()=> {
  // Chrome omits tab.url once access is gone, which is exactly when recovery is needed.
  assert.equal(recoverableAddress('https://a.example/x','https://b.example/y'),'https://a.example/x');
  assert.equal(recoverableAddress(undefined,'https://b.example/y'),'https://b.example/y');
  assert.equal(recoverableAddress(null,'file:///tmp/a.html'),'file:///tmp/a.html');
  for(const [tab,saved] of [[undefined,undefined],[undefined,null],[undefined,'chrome://extensions'],['chrome://extensions','https://b.example/y'],[undefined,'https://user:pass@b.example/y'],[undefined,'not an address']])assert.equal(recoverableAddress(tab,saved),null);
});
test('auto-open remembers handoffs across worker restarts and does not trap Back or reader exits',async()=> {
  const session={},updates=[];let current='https://example.org/a.pdf';
  const chrome={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:event()},
    storage:{local:{async get(){return {pdfAutoOpen:true};}},session:{async get(key){return {[key]:session[key]};},async set(values){Object.assign(session,structuredClone(values));},async remove(key){delete session[key];}}},
    extension:{async isAllowedFileSchemeAccess(){return true;}},permissions:{async contains(){return true;}},
    tabs:{onUpdated:event(),onRemoved:event(),async get(id){return {id,url:current};},async update(id,{url}){updates.push(url);current=url;}},action:{onClicked:event()},sidePanel:{async open(){}},contextMenus:{onClicked:event()}};
  installOpening(chrome);await chrome.tabs.onUpdated.listeners.at(-1)(1,{url:current},{id:1,url:current});assert.equal(updates.length,1);
  const reader=current;await chrome.tabs.onUpdated.listeners.at(-1)(1,{url:reader},{id:1,url:reader});
  installOpening(chrome);current='https://example.org/a.pdf';
  await chrome.tabs.onUpdated.listeners.at(-1)(1,{url:current},{id:1,url:current});await chrome.tabs.onUpdated.listeners.at(-1)(1,{status:'complete'},{id:1,url:current});assert.equal(updates.length,1);
  current='https://example.org/article';await chrome.tabs.onUpdated.listeners.at(-1)(1,{url:current},{id:1,url:current});
  current='https://example.org/b.pdf';await chrome.tabs.onUpdated.listeners.at(-1)(1,{url:current},{id:1,url:current});assert.equal(updates.length,2);
  await chrome.tabs.onRemoved.listeners.at(-1)(1);assert.deepEqual(session,{});
});
test('PDF opening honours setting, granted sites, file access, navigation races and explicit toolbar actions',async()=> {
  let enabled=true,granted=true,fileAccess=false,url='https://example.org/a.pdf'; const updates=[];
  const chrome={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:event()},
    storage:{local:{async get(){return {pdfAutoOpen:enabled};}}},
    extension:{async isAllowedFileSchemeAccess(){return fileAccess;}},permissions:{async contains(){return granted;}},
    tabs:{onUpdated:event(),onRemoved:event(),async get(id){return {id,url};},async update(id,change){updates.push({id,...change});}},
    action:{onClicked:event()},sidePanel:{async open(){}},contextMenus:{onClicked:event()}};
  installOpening(chrome); const updated=chrome.tabs.onUpdated.listeners[0];
  await updated(1,{url},{id:1,url}); assert.equal(updates.length,1); assert.match(updates[0].url,/reader.html/);
  enabled=false; await updated(1,{url},{id:1,url}); assert.equal(updates.length,1);
  enabled=true; granted=false; await updated(1,{url},{id:1,url}); assert.equal(updates.length,1);
  granted=true; assert.equal(await hasSourceAccess(chrome,'file:///tmp/a.pdf'),false); fileAccess=true; assert.equal(await hasSourceAccess(chrome,'file:///tmp/a.pdf'),true);
  const old=url; url='https://example.org/new'; await updated(1,{url:old},{id:1,url:old}); assert.equal(updates.length,1);
  chrome.action.onClicked.listeners[0]({id:1,url:old}); await new Promise(r=>setImmediate(r)); assert.equal(updates.length,2);
  chrome.contextMenus.onClicked.listeners[0]({menuItemId:'sharh-open-pdf',linkUrl:'https://example.org/download?id=book'},{id:1,url:'https://example.org/'});
  await new Promise(r=>setImmediate(r)); assert.equal(updates.length,3);
  assert.equal(new URL(updates[2].url).searchParams.get('source'),'https://example.org/download?id=book');
});

test('the right-click menu groups Sharh actions, and "Read this page" opens the panel with a read request instead of a new tab',async()=> {
  const items=[],session={},opened=[],created=[];
  const chrome={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:event()},
    storage:{local:{async get(){return {};}},session:{async get(){return session;},async set(v){Object.assign(session,v);},async remove(){}}},
    extension:{async isAllowedFileSchemeAccess(){return true;}},permissions:{async contains(){return true;}},
    tabs:{onUpdated:event(),onRemoved:event(),async get(id){return {id};},async update(){},async create(v){created.push(v);}},action:{onClicked:event()},
    sidePanel:{async open(v){opened.push(v);},async setPanelBehavior(){}},contextMenus:{onClicked:event(),async removeAll(){},create(v){items.push(v);}}};
  await createReaderMenus(chrome);installOpening(chrome);
  assert.deepEqual(items.map(i=>[i.id,i.parentId??null,i.title]),[['sharh',null,'Sharh'],['sharh-read-page','sharh','Read this page'],['sharh-open-pdf','sharh','Open this PDF in Sharh']]);
  chrome.contextMenus.onClicked.listeners[0]({menuItemId:'sharh-read-page'},{id:7,url:'https://example.org/a'});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(opened,[{tabId:7}]);assert.equal(created.length,0);assert.equal(session[READ_INTENT].tabId,7);
});
