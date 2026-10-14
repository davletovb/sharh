import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {serveRepository,browserOptions} from '../../scripts/lib/browser-fixtures.mjs';
const id='npmhefooiolfpmhicinblelaideeejcm', base=`chrome-extension://${id}`;
test('packaged reader: local HTML/PDF, selectable text, scopes, highlights, storage reload, export/import and cascades',async()=> {
  const profile=await mkdtemp(join(tmpdir(),'sharh-c-reader-')), server=await serveRepository(), report={checks:{},errors:[]}; let context;
  try {
    const extension=resolve('dist/sharh');
    context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
    context.setDefaultTimeout(15000);
    const reader=await context.newPage(); reader.on('pageerror',error=>report.errors.push(error.message));
    await reader.goto(`${base}/ui/reader.html`);
    await reader.locator('#open-file').setInputFiles('corpus/fixtures/html/article-en.html');
    await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    assert.ok(await reader.locator('#text-blocks .block').count()>4);
    report.checks.localHTML=true;
    const selection=await reader.evaluate(()=> {
      const p=document.querySelectorAll('#text-blocks [data-text]')[3],range=document.createRange(); range.setStart(p.firstChild,1); range.setEnd(p.firstChild,8); getSelection().removeAllRanges(); getSelection().addRange(range);
      return p.textContent.slice(1,8);
    });
    await reader.locator('#scope-kind').selectOption('selection');
    await reader.waitForFunction(()=>document.querySelector('#scope-size').textContent.includes('UTF-8 bytes'));
    assert.ok(selection.length>0); report.checks.selectionScope=true;
    await reader.locator('#scope-kind').selectOption('section'); assert.match(await reader.locator('#scope-size').textContent(),/UTF-8/);
    await reader.locator('#open-file').setInputFiles('corpus/fixtures/pdf/footnotes-injection.pdf');
    await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]'));
    assert.equal(await reader.locator('.pdf-page').count(),2);
    assert.ok(await reader.locator('.textLayer span').count()>4);
    const textRect=await reader.locator('.textLayer span').filter({hasText:'Public partici-'}).first().boundingBox();
    assert.ok(textRect.width>0 && textRect.height>0);
    await reader.evaluate(()=> {
      const spans=[...document.querySelectorAll('.textLayer span')], first=spans.find(el=>el.textContent==='Public partici-'), second=spans.find(el=>el.textContent.startsWith('pation gives'));
      const range=document.createRange(); range.setStart(first.firstChild,7); range.setEnd(second.firstChild,5); getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await reader.locator('#scope-kind').selectOption('selection');
    await reader.waitForFunction(()=>document.querySelector('#scope-size').textContent.includes('UTF-8 bytes'));
    report.checks.pdfSelectionScope=true;
    await reader.locator('#scope-kind').selectOption('pages'); await reader.locator('#scope-first').fill('2'); await reader.locator('#scope-last').fill('2'); await reader.locator('#scope-last').dispatchEvent('change');
    await reader.waitForFunction(()=>document.querySelector('#scope-help').textContent.startsWith('Estimated'));
    await reader.locator('#outline button').first().click(); await reader.waitForFunction(()=>document.querySelector('.pdf-highlight'));
    const rect=await reader.locator('.pdf-highlight').first().boundingBox(); assert.ok(rect.width>0 && rect.height>0);
    await reader.screenshot({path:'test-results/c-reader.png'});
    report.checks.renderedSelectablePDF=true; report.checks.pdfHighlight=true; report.checks.pageScope=true;
    const archive=await reader.evaluate(async()=> { const {openDocumentStore}=await import('../documents.mjs'),store=await openDocumentStore(); try{return await store.exportData();}finally{store.close();} });
    assert.equal(archive.stores.docs.length,2); assert.ok(archive.stores.sources.some(s=>s.bytes?.length>0));
    await reader.reload(); await reader.locator('#saved-documents article').filter({hasText:'footnotes-injection.pdf'}).getByRole('button',{name:'Open',exact:true}).click();
    await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]')); report.checks.persistedPDFReload=true;
    const roundTrip=await reader.evaluate(async archive=> {
      const {openDocumentStore}=await import('../documents.mjs'),store=await openDocumentStore({name:'round-trip'});
      try { await store.importData(archive); return await store.exportData(); } finally {store.close();}
    },archive);
    assert.deepEqual(roundTrip,archive); report.checks.browserIndexedDBRoundTrip=true;
    const cascade=await reader.evaluate(async archive=> {
      const {openDocumentStore}=await import('../documents.mjs'), store=await openDocumentStore({name:'round-trip'}), docId=archive.stores.docs[0].id;
      try {
        await store.put('runs',{id:'fixture-run',docId,target:{path:'seatline',provider:'codex'},session:{handle:'fixture-handle'},cleanupGroup:'fixture-group'});
        await store.put('records',{runId:'fixture-run',sequence:0,record:{t:'note',text:'Stored record'}});
        await store.put('chats',{id:'fixture-chat',docId,messages:[]});
        await store.deleteDocument(docId);
        const after=await store.exportData();
        return {deleted:await store.getDocument(docId),docs:after.stores.docs.length,runs:after.stores.runs.length,records:after.stores.records.length,chats:after.stores.chats.length,maintenance:after.stores.maintenance.length};
      }finally{store.close();}
    },archive);
    assert.deepEqual(cascade,{deleted:null,docs:1,runs:0,records:0,chats:0,maintenance:2}); report.checks.browserIndexedDBCascade=true;
    const dropPDF=await readFile('corpus/fixtures/pdf/two-column.pdf');
    await reader.evaluate(bytes=>{ const transfer=new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)],'dropped.pdf',{type:'application/pdf'})); document.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})); },[...dropPDF]);
    await reader.waitForFunction(()=>document.querySelector('#saved-documents').textContent.includes('dropped.pdf'));
    report.checks.dragDrop=true;
    // Preapprove the synthetic host in an isolated profile, then activate the real optional grant
    // through permissions.request in a click handler (the same approach as Lineleaf's installed tests).
    const settings=await context.newPage(); await settings.goto(`chrome://extensions/?id=${id}`);
    await settings.evaluate(async ({id,origin})=> {
      await chrome.developerPrivate.addHostPermission(id,origin+'/*');
      await chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,fileAccess:true});
    },{id,origin:server.url});
    await reader.evaluate(origin=> {
      const button=document.createElement('button'); button.id='fixture-grant'; button.textContent='Grant fixture site';
      button.onclick=async()=>{window.fixtureGranted=await chrome.permissions.request({origins:[origin+'/*']});}; document.body.append(button);
    },server.url);
    await reader.locator('#fixture-grant').click(); await reader.waitForFunction(()=>window.fixtureGranted===true);
    const source=await context.newPage(); await source.goto(`${server.url}/corpus/fixtures/html/article-en.html`);
    const tabId=await reader.evaluate(async sourceURL=>(await chrome.tabs.query({})).find(t=>t.url===sourceURL).id,source.url());
    await reader.goto(`${base}/ui/reader.html?tab=${tabId}`);
    await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    await reader.locator('#text-blocks .paragraph').nth(2).click();
    await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Highlighted'));
    assert.equal(await source.evaluate(()=>CSS.highlights.has('sharh-reference')),true); report.checks.productionPageInjection=true;
    // Actual PDF navigation exercises the worker, without a test-specific route or changed manifest.
    await source.goto(`${server.url}/corpus/fixtures/pdf/outlined-book.pdf`,{waitUntil:'commit'}).catch(()=>{});
    await source.waitForURL(url=>url.href.startsWith(`${base}/ui/reader.html?source=`));
    await source.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]')); report.checks.pdfAutoOpen=true;
    await source.locator('#chrome-viewer').click();
    await source.waitForURL(url=>url.href.startsWith(server.url));
    assert.equal(await reader.evaluate(async()=>(await chrome.storage.local.get('pdfAutoOpen')).pdfAutoOpen),false);
    report.checks.chromeViewerWhenOff=true;
    const fileURL=pathToFileURL(resolve('corpus/fixtures/pdf/book-without-outline.pdf')).href;
    await reader.goto(`${base}/ui/reader.html?source=${encodeURIComponent(fileURL)}`);
    const fileGrant=await reader.evaluate(async()=>chrome.permissions.contains({origins:['file:///*']}));
    if (!fileGrant) {
      await settings.evaluate(async id=>chrome.developerPrivate.addHostPermission(id,'file:///*'),id);
      await reader.locator('#allow-source').click();
    }
    await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]')); report.checks.filePDFWithAccess=true;
    const localPage=await context.newPage(), localHTML=pathToFileURL(resolve('corpus/fixtures/html/article-en.html')).href;
    await localPage.goto(localHTML);
    const localTab=await reader.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,localHTML);
    await reader.goto(`${base}/ui/reader.html?tab=${localTab}`);
    await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    report.checks.fileHTMLWithAccess=true;
    await reader.evaluate(origin=>chrome.permissions.remove({origins:[origin+'/*']}),server.url);
    await settings.evaluate(async ({id,origin})=>chrome.developerPrivate.removeHostPermission(id,origin+'/*'),{id,origin:server.url});
    await reader.goto(`${base}/ui/reader.html?source=${encodeURIComponent(server.url+'/corpus/fixtures/pdf/outlined-book.pdf')}`);
    await reader.waitForFunction(()=>document.querySelector('#allow-source').hidden===false); report.checks.permissionRemoval=true;
    assert.deepEqual(report.errors,[]);
  } finally {
    await context?.close(); await rm(profile,{recursive:true,force:true}); await server.close();
    await mkdir('test-results',{recursive:true}); await writeFile('test-results/c-extension.json',JSON.stringify(report,null,2)+'\n');
  }
});
