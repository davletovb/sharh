import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceURL,sourceOrigin,isPDFAddress,readerURL,installOpening,hasSourceAccess} from '../extension/lib/opening.mjs';
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
