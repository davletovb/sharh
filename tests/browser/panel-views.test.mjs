import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions,serveRepository} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const id='npmhefooiolfpmhicinblelaideeejcm',base=`chrome-extension://${id}`;
async function start(){const profile=await mkdtemp(join(tmpdir(),'sharh-e-')),extension=resolve('dist/sharh');const context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});context.setDefaultTimeout(20000);return {profile,context};}
async function waitForValue(page,read){const deadline=Date.now()+20000;do{const value=await page.evaluate(read);if(value)return value;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);throw Error('Timed out waiting for stored passage context.');}
async function axe(page){const cdp=await page.context().newCDPSession(page);try{await cdp.send('Runtime.evaluate',{expression:await readFile('node_modules/axe-core/axe.min.js','utf8')});}finally{await cdp.detach();}return page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return {violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),passes:result.passes.length};});}

test('E: packaged panel/settings themes, all streaming views, keyboard inspection, versions, RTL/fonts and accessibility',async()=>{
 const {profile,context}=await start(),report={checks:{},a11y:{},errors:[]};
 try{
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/ui/panel.html');await page.locator('.workspace-nav').waitFor();
  for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});report.a11y['panel-'+theme]=await axe(page);assert.deepEqual(report.a11y['panel-'+theme].violations,[]);}
  const settings=await context.newPage();settings.on('pageerror',e=>report.errors.push(e.message));await settings.goto(base+'/ui/settings.html');await settings.locator('#appearance-controls select').waitFor();
  for(const theme of ['light','dark']){await settings.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});report.a11y['settings-'+theme]=await axe(settings);assert.deepEqual(report.a11y['settings-'+theme].violations,[]);}
  await settings.close();await installBrowserTestAPI(page);
  await page.evaluate(async()=>{
   const {openDocumentStore,exampleDocument,AnalysisEngine,FakePath,createWorkspace}=SharhTest;
   const store=await openDocumentStore({name:'e-ui'}),doc=await exampleDocument();await store.saveDocument(doc);
   const line=r=>JSON.stringify(r)+'\n',end={t:'end'},node=(i,text='Claim '+i)=>({t:'node',id:'n'+i,kind:'claim',text,refs:[3],basis:'inferred'});
   const scripts=[{chunks:Array.from({length:200},(_,i)=>({text:line(node(i,i===0?'<svg onload=alert(1)>':undefined)),delayMs:4})).concat({text:line(end),delayMs:4})},
    {text:[...['line','abstract','section','brief'].map(level=>({t:'sum',level,text:'A summary for '+level,refs:[3]})),...['opening','problem','development','turn','resolution'].map((stage,i)=>({t:'arc',n:i+1,stage,text:'Stage '+stage,refs:[3]})),end].map(line).join('')},
    {text:[{t:'sec',id:'root',title:'The public argument',role:'claim',gist:'Root section',span:[1,7]},{t:'sec',id:'child',parent:'root',title:'Evidence',role:'evidence',gist:'Supporting section',span:[2,6]},end].map(line).join('')},
    {text:[node(201),node(202),{t:'edge',from:'n201',to:'n202',rel:'supports'},{t:'step',n:1,text:'Reasoning in order',refs:[3]},{t:'gap',kind:'unstated_premise',at:['n201'],text:'An unstated premise',refs:[3]},end].map(line).join('')},
    {text:[{t:'concept',id:'read',term:'Oʻqish · Ўқиш',gloss:'Reading',refs:[3]},{t:'concept',id:'public',term:'Public',gloss:'A public',refs:[4]},{t:'edge',from:'read',to:'public',rel:'causes'},
      {t:'facet',kind:'assumption',text:'القراءة نافعة لكل الناس',refs:[3],basis:'inferred'},end].map(line).join('')}];
   const path=new FakePath({scripts,delayMs:2}),engine=new AnalysisEngine({store,paths:{fake:path}}),main=document.createElement('main'),h=document.createElement('h1');h.textContent='Sharh reading workspace';main.append(h);const host=document.createElement('div');main.append(host);document.body.replaceChildren(main);
   const storage={async get(){return {};},async set(){}},changes={addListener(){},removeListener(){}},refs=[];
   const workspace=await createWorkspace(host,{store,engine,client:{call:async method=>method==='discover'?path.discover():null},storage,changes,onReference:b=>refs.push(b.n)});
   await workspace.ready;await workspace.setDocument(doc);window.e={workspace,store,engine,path,doc,refs,longTasks:[]};
   await document.fonts.ready;
   window.e.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())e.longTasks.push(entry.duration);});e.observer.observe({type:'longtask',buffered:false});
  });
  const lens=page.locator('.analysis-controls select');await lens.selectOption('logic');await page.locator('.analysis-controls input[type=number]').fill('200');await page.locator('.analysis-controls').getByRole('button',{name:'Analyze',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-results .finding').length>0 && e.workspace.active);
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length>0 && e.workspace.active);
  report.checks.incrementalMapAndCards=true;
  await page.waitForFunction(()=>!e.workspace.active && document.querySelectorAll('.analysis-results .finding').length===200);
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===200);
  report.checks.streaming=await page.evaluate(()=>{e.observer.disconnect();return {...e.workspace.view.metrics,longTasks:e.longTasks,maxTask:Math.max(0,...e.longTasks)};});
  assert.ok(report.checks.streaming.maxRenderMs<100);assert.ok(report.checks.streaming.maxTask<100,JSON.stringify(report.checks.streaming));
  assert.equal(await page.locator('.analysis-results svg[onload]').count(),0);assert.match(await page.locator('.analysis-results').textContent(),/<svg/);
  await page.locator('.analysis-map .map-node').first().focus();await page.keyboard.press('Enter');await page.locator('.finding-inspector').waitFor();assert.match(await page.locator('.finding-inspector').textContent(),/Inferred/);assert.ok((await page.evaluate(()=>e.refs)).includes(3));report.checks.keyboardInspection=true;
  for(const current of ['summary','structure','logic','thinking']){
   await lens.selectOption(current);await page.locator('.analysis-controls').getByRole('button',{name:'Analyze',exact:true}).click();await page.waitForFunction(()=>!e.workspace.active && document.querySelector('.run-state').textContent.startsWith('Completed'));await page.evaluate(()=>e.workspace.view.settled());
   if(current==='summary'){assert.equal(await page.locator('.finding.sum').count(),4);assert.equal(await page.locator('.finding.arc').count(),5);}
   if(current==='structure'){await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===2);await page.getByRole('button',{name:'Collapse branch'}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===1);assert.equal(await page.locator('.finding.sec:visible').count(),1);await page.getByRole('button',{name:'Expand branch'}).click();}
   if(current==='logic'){assert.equal(await page.locator('.finding.gap').count(),1);assert.equal(await page.locator('.finding.step').count(),1);}
   if(current==='thinking'){assert.equal(await page.locator('.finding.concept').count(),2);assert.match(await page.locator('.record-group').allTextContents().then(r=>r.join(' ')),/Causal chain/);}
   for(const theme of ['parchment','ink']){await page.locator('.appearance-controls select').selectOption(theme);await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);const result=await axe(page);report.a11y[current+'-'+theme]=result;assert.deepEqual(result.violations,[]);}
  }
  report.checks.allPhaseOneViews=true;
  const typography=await page.evaluate(async()=>{await document.fonts.load('16px "Noto Serif"','Oʻqish Ўқиш');await document.fonts.load('16px "Noto Sans Arabic"','القراءة');return {serif:document.fonts.check('16px "Noto Serif"','Oʻqish Ўқиш'),arabic:document.fonts.check('16px "Noto Sans Arabic"','القراءة'),rtl:getComputedStyle(document.querySelector('.finding.facet .reading-text')).direction};});
  assert.ok(typography.serif && typography.arabic);assert.equal(typography.rtl,'rtl');report.checks.typography=typography;
  await page.locator('.analysis-view').screenshot({path:'test-results/e-thinking-ink.png'});await page.locator('.appearance-controls select').selectOption('parchment');await page.locator('.analysis-view').screenshot({path:'test-results/e-thinking-parchment.png'});
  const saved=await page.evaluate(async()=>{const rows=await e.engine.list(e.doc.id);return {calls:e.path.calls.length,logic:rows.filter(r=>r.lens==='logic').map(r=>r.id)};});
  await page.locator('.run-history select').first().selectOption(saved.logic[0]);await page.locator('.run-history select').nth(1).selectOption(saved.logic[1]);await page.getByRole('button',{name:'Compare versions',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.compare-columns>section').length===2);
  assert.equal(await page.evaluate(()=>e.path.calls.length),saved.calls);report.checks.savedVersionComparison=true;assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await context.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/e-views.json',JSON.stringify(report,null,2)+'\n');}
});

test('E: actual optional-site selection toolbar opens the panel once, carries context and hides after permission removal; PDF selection has the four actions',async()=>{
 const {profile,context}=await start(),server=await serveRepository(),report={checks:{},errors:[]};
 try{
  const reader=await context.newPage();reader.on('pageerror',e=>report.errors.push(e.message));await reader.goto(base+'/ui/reader.html');await reader.locator('.workspace-nav').waitFor();
  const source=await context.newPage();await source.goto(server.url+'/corpus/fixtures/html/article-en.html');assert.equal(await source.locator('[data-sharh-toolbar]').count(),0);
  const management=await context.newPage();await management.goto('chrome://extensions/');await management.evaluate(async({id,origin})=>{await chrome.developerPrivate.addHostPermission(id,origin+'/*');},{id,origin:server.url});
  await reader.evaluate(origin=>{const b=document.createElement('button');b.id='grant-e';b.textContent='Enable fixture site';b.onclick=async()=>{window.grantedE=await chrome.permissions.request({origins:[origin+'/*']});};document.body.append(b);},server.url);await reader.locator('#grant-e').click();await reader.waitForFunction(()=>window.grantedE===true);
  await source.reload();await source.evaluate(()=>{const aside=document.createElement('aside'),p=document.createElement('p');p.id='selected-sidebar';p.textContent='A selected appendix outside the article.';aside.append(p);document.body.append(aside);const range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,Math.min(20,p.firstChild.length));getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));});
  await source.locator('[data-sharh-toolbar]').waitFor();await source.waitForFunction(()=>document.querySelector('[data-sharh-toolbar]').getBoundingClientRect().height>30);report.checks.optionalPermissionToolbar=true;
  // Keyboard reaches a closed-shadow toolbar without exposing source-page script access.
  await source.bringToFront();await source.evaluate(()=>document.activeElement?.blur());for(let i=0;i<30;i++){await source.keyboard.press('Tab');if(await source.evaluate(()=>document.activeElement?.hasAttribute('data-sharh-toolbar')))break;}
  assert.ok(await source.evaluate(()=>document.activeElement?.hasAttribute('data-sharh-toolbar')));await source.keyboard.press('Enter');
  const saved=await waitForValue(reader,async()=>Object.entries(await chrome.storage.session.get(null)).filter(([key])=>key.startsWith('sharh:panel-context:')).map(([,value])=>value).find(value=>value?.docId)??false);assert.ok(saved.docId);report.checks.actionOpensAndCarriesContext=true;
  const pending=await waitForValue(reader,async()=>Object.entries(await chrome.storage.session.get(null)).find(([key])=>key.startsWith('sharh:passage:'))?.[1]??false);assert.equal(pending.action,'Explain');
  await installBrowserTestAPI(reader);const sidebar=await reader.evaluate(async saved=>{const store=await SharhTest.openDocumentStore();try{const doc=await store.getDocument(saved.docId,saved.version);return doc.blocks.find(b=>b.text==='A selected appendix outside the article.');}finally{store.close();}},saved);assert.equal(sidebar.anchor.includeNavigation,true);report.checks.outsideArticleSelection=true;
  const panel=await context.newPage();await panel.goto(base+'/ui/panel.html');await panel.locator('#retry-passage').waitFor();await panel.locator('#retry-passage').click();await panel.waitForFunction(()=>document.querySelector('#read-state').textContent.includes('Choose a signed-in'));
  const retained=await panel.evaluate(async()=>Object.entries(await chrome.storage.session.get(null)).find(([key])=>key.startsWith('sharh:passage:'))?.[1]);assert.equal(retained.id,pending.id);report.checks.failedHandoffRemainsRetryable=true;await panel.close();
  await source.evaluate(()=>{const p=document.querySelectorAll('article p')[2]??document.querySelector('p'),range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));});
  await source.waitForFunction(()=>document.querySelector('[data-sharh-toolbar]').getBoundingClientRect().height>30);
  await reader.evaluate(origin=>chrome.permissions.remove({origins:[origin+'/*']}),server.url);
  await source.waitForFunction(()=>document.querySelector('[data-sharh-toolbar]').getBoundingClientRect().height===0);report.checks.revokedPermissionHidesToolbar=true;
  await reader.locator('#open-file').setInputFiles('corpus/fixtures/pdf/footnotes-injection.pdf');await reader.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered=true]'));
  await reader.evaluate(()=>{const p=[...document.querySelectorAll('.textLayer span')].find(el=>el.textContent==='Public partici-'),range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));});
  const toolbar=reader.getByRole('toolbar',{name:'Passage actions'});await toolbar.waitFor();for(const action of ['Explain','Translate','Logic','Define'])assert.ok(await toolbar.getByRole('button',{name:action,exact:true}).isVisible());
  await reader.bringToFront();await toolbar.getByRole('button',{name:'Explain',exact:true}).focus();await reader.keyboard.press('ArrowRight');assert.equal(await reader.evaluate(()=>document.activeElement.textContent),'Translate');await reader.keyboard.press('Escape');assert.equal(await toolbar.isVisible(),false);report.checks.pdfToolbarKeyboard=true;
  assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await context.close();await server.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/e-passages.json',JSON.stringify(report,null,2)+'\n');}
});
