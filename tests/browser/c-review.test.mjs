import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {browserOptions,serveRepository,fixtureBrowser} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const id='npmhefooiolfpmhicinblelaideeejcm',base=`chrome-extension://${id}`;
async function waitForChromeEscape(page) {
  // The deliberately missing PDF commits Chrome's error document. Navigation
  // waiters can reject before its frame URL updates; observe the committed DOM
  // context instead, without accepting a failed navigation that stayed in Sharh.
  await page.waitForFunction(prefix=>!location.href.startsWith(prefix),base);
  assert.ok(!page.url().startsWith(base),'navigation must actually leave Sharh');
}
test('failed opens preserve the current reader, pending PDF grants resume the requested source, and auto-open has an escape',async()=> {
  const profile=await mkdtemp(join(tmpdir(),'sharh-c-review-')),server=await serveRepository(),report={checks:{},errors:[]};let context;
  try {
    const extension=resolve('dist/sharh');
    context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});context.setDefaultTimeout(15000);
    const reader=await context.newPage();reader.on('pageerror',e=>report.errors.push(e.message));await reader.goto(`${base}/ui/reader.html`);
    const file={name:'index.html',mimeType:'text/html',buffer:Buffer.from('<h1>First local file</h1><p>First source content.</p>')};
    await reader.locator('#open-file').setInputFiles(file);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    await reader.locator('#open-file').setInputFiles({...file,buffer:Buffer.from('<h1>Second local file</h1><p>Second source content.</p>')});await reader.waitForFunction(()=>document.querySelector('#text-blocks').textContent.includes('Second source content.'));
    await installBrowserTestAPI(reader);
    const sameName=await reader.evaluate(async()=>{const s=await SharhTest.openDocumentStore();try{return(await s.listDocuments()).filter(d=>d.fileName==='index.html').map(d=>d.id);}finally{s.close();}});
    assert.equal(new Set(sameName).size,2);report.checks.sameNameHTML=true;
    const blank=await PDFDocument.create();blank.addPage();const blankFile={name:'blank.pdf',mimeType:'application/pdf',buffer:Buffer.from(await blank.save())};
    await reader.locator('#open-file').setInputFiles(blankFile);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.includes('no extractable text'));
    assert.ok((await reader.locator('#text-blocks').textContent()).includes('Second source content.'));
    await reader.locator('#text-blocks .paragraph').last().click();assert.equal(await reader.locator('#text-blocks .selected').count(),1);report.checks.failedPDFOverHTML=true;
    await reader.locator('#open-file').setInputFiles('corpus/fixtures/pdf/outlined-book.pdf');await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]'));
    const previousTitle=await reader.locator('#document-title').textContent();
    await reader.locator('#open-file').setInputFiles(blankFile);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.includes('no extractable text'));
    assert.equal(await reader.locator('#document-title').textContent(),previousTitle);assert.equal(await reader.locator('.pdf-page').count(),2);
    await reader.locator('#outline button').first().click();await reader.waitForFunction(()=>document.querySelector('.pdf-highlight'));report.checks.failedPDFOverPDF=true;
    await reader.evaluate(()=>chrome.tabs.create({url:'chrome://version/'}));
    await reader.locator('#read-current').click();await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.includes('Allow access to the source'));
    assert.equal(await reader.locator('#document-title').textContent(),previousTitle);assert.equal(await reader.locator('.pdf-page').count(),2);
    await reader.locator('#outline button').first().click();await reader.waitForFunction(()=>document.querySelector('.pdf-highlight'));report.checks.deniedTabPreservesPDF=true;
    const management=await context.newPage();await management.goto('chrome://extensions/');
    await management.evaluate(async({id,origin})=>{await chrome.developerPrivate.addHostPermission(id,origin+'/*');await chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,fileAccess:true});},{id,origin:server.url});
    // Use the production permission control for the synthetic source.
    await reader.locator('#source-address').fill(server.url+'/corpus/fixtures/pdf/outlined-book.pdf');await reader.locator('#open-address button').click();await reader.locator('#allow-source').click();
    await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    const source=await context.newPage();await source.goto(server.url+'/corpus/fixtures/html/article-en.html');
    const tabId=await reader.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());
    await reader.goto(`${base}/ui/reader.html?tab=${tabId}`);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
    const fileURL=pathToFileURL(resolve('corpus/fixtures/pdf/book-without-outline.pdf')).href;
    await management.evaluate(id=>chrome.developerPrivate.addHostPermission(id,'file:///*'),id);
    await reader.locator('#source-address').fill(fileURL);await reader.locator('#open-address button').click();await reader.locator('#allow-source').click();
    await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]'));
    assert.match(await reader.locator('#document-title').textContent(),/book-without-outline/);assert.equal(await reader.locator('#allow-source').isVisible(),false);report.checks.pendingPDFGrantAfterTab=true;
    const failure=await context.newPage(),missing=server.url+'/missing.pdf';await failure.goto(missing,{waitUntil:'commit'}).catch(()=>{});
    await failure.waitForURL(url=>url.href.startsWith(base+'/ui/reader.html?source='));await failure.waitForFunction(()=>document.querySelector('#reader-state').textContent.includes('HTTP 404'));
    assert.equal(await failure.locator('#chrome-viewer').isVisible(),true);report.checks.failedAutoOpenEscape=true;
    const control=await context.newCDPSession(reader);await control.send('ServiceWorker.enable');await control.send('ServiceWorker.stopAllWorkers');await control.detach();
    await failure.goBack({waitUntil:'commit'}).catch(()=>{});await waitForChromeEscape(failure);await failure.waitForTimeout(600);assert.ok(!failure.url().startsWith(base));report.checks.backAfterWorkerRestart=true;
    await failure.goForward({waitUntil:'domcontentloaded'}).catch(()=>{});await failure.waitForFunction(()=>document.querySelector('#chrome-viewer')?.hidden===false);
    await failure.locator('#chrome-viewer').click();await waitForChromeEscape(failure);report.checks.escapeFromFailedFetch=true;
    await reader.goto(`${base}/ui/reader.html?doc=missing`);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.includes('could not be found'));report.checks.staleDocumentURL=true;
    assert.deepEqual(report.errors,[]);
  }finally{await context?.close();await server.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/c-review-ui.json',JSON.stringify(report,null,2)+'\n');}
});
test('PDF canvases are released while reading a book and a failed page render can retry',async()=> {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<24;i++){const p=doc.addPage([600,800]);p.drawText(`Chapter ${i+1}`,{x:45,y:730,size:18,font});p.drawText(`Body text for page ${i+1}. Select a small passage.`,{x:45,y:600,size:12,font});}
  const bytes=[...await doc.save()],world=await fixtureBrowser({module:'/dist/readers.mjs'});
  try {
    await world.page.goto(world.server.url+'/dist/index.html');await installBrowserTestAPI(world.page);
    await world.page.evaluate(async bytes=> {
      const r=await import('/dist/readers.mjs'),pdf=await r.openPDF(bytes),extraction=await r.extractPDF(pdf,'long-book');
      const model=r.createDocument(extraction,{kind:'pdf',identity:'long-book'}),container=document.createElement('div');document.body.append(container);
      let failed=false;
      const wrapped={numPages:pdf.numPages,getPage(n){if(n===3&&!failed){failed=true;return Promise.reject(Error('Transient page failure'));}return pdf.getPage(n);}};
      const view=new SharhTest.PDFView(container);await view.open(wrapped,model);globalThis.memoryTest={pdf,model,view,firstCanvas:container.querySelector('canvas')};
      view.pinned=2;
      try{await view.render(2);throw Error('Expected the first render to fail');}catch(error){if(error.message!=='Transient page failure')throw error;}
      await view.render(2);if(view.pages.get(2).el.dataset.rendered!=='true')throw Error('Page retry failed');
    },bytes);
    for(const page of [3,7,12,18,23]) {
      const count=await world.page.evaluate(async page=>{const {view,model}=memoryTest;await view.highlight(model.blocks.find(b=>b.page===page).anchor);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return document.querySelectorAll('.pdf-page canvas').length;},page);
      assert.ok(count<=5,`kept ${count} canvases after page ${page+1}`);
    }
    const state=await world.page.evaluate(()=>({width:memoryTest.firstCanvas.width,height:memoryTest.firstCanvas.height,rendered:document.querySelectorAll('.pdf-page[data-rendered="true"]').length}));
    assert.equal(state.width,0);assert.equal(state.height,0);assert.ok(state.rendered<=5);
    await world.page.evaluate(async()=>{memoryTest.view.clear();await memoryTest.pdf.loadingTask.destroy();});
  }finally{await world.close();}
});
