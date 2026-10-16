import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {browserOptions,serveRepository} from '../../scripts/lib/browser-fixtures.mjs';
import {installBrowserTestAPI} from '../helpers/browser-api-loader.mjs';
const id='npmhefooiolfpmhicinblelaideeejcm',base=`chrome-extension://${id}`;
async function start(){const profile=await mkdtemp(join(tmpdir(),'sharh-e-')),extension=resolve('dist/sharh');const context=await chromium.launchPersistentContext(profile,{...browserOptions(),channel:'chromium',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});context.setDefaultTimeout(20000);await context.addInitScript(()=>{try{localStorage.setItem('sharh:layout','studio');}catch{/* The tests drive every control. */}});return {profile,context};}
async function waitForValue(page,read){const deadline=Date.now()+20000;do{const value=await page.evaluate(read);if(value)return value;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);throw Error('Timed out waiting for stored passage context.');}
async function axe(page){const cdp=await page.context().newCDPSession(page);try{await cdp.send('Runtime.evaluate',{expression:await readFile('node_modules/axe-core/axe.min.js','utf8')});}finally{await cdp.detach();}return page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return {violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),passes:result.passes.length};});}

test('passage clicks use the contract and saved selection; invalid Quick responses explain failure and retry with the default model',async()=>{
 const {profile,context}=await start(),report={checks:{},errors:[]};
 try{
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/ui/reader.html');await page.locator('.workspace-nav').waitFor();await installBrowserTestAPI(page);
  await page.evaluate(async()=>{
   const {openDocumentStore,exampleDocument,AnalysisEngine,FakePath,createWorkspace,installSelectionToolbar}=SharhTest,store=await openDocumentStore({name:'passage-recovery'}),doc=await exampleDocument();await store.saveDocument(doc);
   const host=document.createElement('main');host.id='passage-fixture';const source=document.createElement('p');source.id='passage-source';source.textContent=doc.blocks[4].text;document.body.append(source,host);
   const info={path:'seatline',provider:'claude',available:true,signedIn:true,accepted:true,models:[],capabilities:{streaming:true,sessions:false,toolIsolation:true,effort:['low','medium']}},data={sharhReading:{language:'uz-Latn',tiers:{analysis:{path:'seatline',provider:'claude',model:'sonnet',effort:'medium'}}}},storage={async get(k){return {[k]:structuredClone(data[k])};},async set(v){Object.assign(data,structuredClone(v));}};
   const path=new FakePath({sessions:false,wait:async()=>{},scriptFor:({target,request})=>{
    if(window.p.fail && target.model==='haiku')return {text:'{"text":"Missing record tag","refs":[5]}\n{"t":"end"}\n'};
    const task=JSON.parse(request.task.split('\n')[1]),contract=JSON.parse(request.task.split('SHARH_OUTPUT_CONTRACT\n')[1]),scope=JSON.parse(request.document),block=scope.blocks.find(b=>b.selected),type=task.lens==='logic'?'node':task.lens==='check'?'chk':'note',values={id:'n1',kind:'claim',part:'claim',text:block.selected.map(s=>s.text).join(' / '),refs:[block.n],basis:'inferred'};
    const record=Object.fromEntries(Object.entries(contract.types[type]).filter(([,s])=>!s.type.endsWith('?')).map(([k,s])=>[k,s.type==='literal'?s.value:values[k]]));record.refs=[block.n];return {text:JSON.stringify(record)+'\n'+JSON.stringify({t:contract.types.end.t.value})+'\n'};
   }});path.discover=async()=>[info];const engine=new AnalysisEngine({store,paths:{seatline:path}}),workspace=await createWorkspace(host,{store,engine,client:{call:async m=>m==='discover'?[info]:null},storage,changes:{addListener(){},removeListener(){}}});await workspace.ready;await workspace.setDocument(doc);
   const toolbar=installSelectionToolbar({document,selection:range=>({spans:[{n:5,start:range.startOffset,end:range.endOffset}]}),onAction:(...args)=>workspace.passage(...args)});window.p={store,doc,path,engine,workspace,toolbar,fail:false};
  });
  const fixture=page.locator('#passage-fixture'),toolbar=page.getByRole('toolbar',{name:'Passage actions'});
  async function select(start,end){await page.evaluate(({start,end})=>{const r=document.createRange(),node=document.getElementById('passage-source').firstChild;r.setStart(node,start);r.setEnd(node,end);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));},{start,end});await toolbar.waitFor();}
  for(const [i,action]of ['Explain','Translate','Argument','Define'].entries()){
   await select(i,i+8);await toolbar.getByRole('button',{name:action,exact:true}).click();await page.waitForFunction(count=>p.path.calls.length===count && !p.workspace.active,i+1);await page.evaluate(()=>p.workspace.view.settled());
   assert.match(await fixture.locator('.run-state').textContent(),/Completed/);const task=await page.evaluate(()=>JSON.parse(p.path.calls.at(-1).request.task.split('\n')[1]));assert.equal(task.action,action);
  }report.checks.fourClickedActions=true;
  await page.evaluate(()=>p.fail=true);await select(0,7);await toolbar.getByRole('button',{name:'Translate',exact:true}).click();await page.waitForFunction(()=>p.path.calls.length===6 && !p.workspace.active);
  assert.match(await fixture.locator('.run-state').textContent(),/Response format failed/);await fixture.locator('.run-diagnostics summary').click();assert.match(await fixture.locator('.run-diagnostics').textContent(),/missing or unsupported record type/);
  report.checks.failureExplained=true;await fixture.getByRole('button',{name:'Retry with default model',exact:true}).click();await page.waitForFunction(()=>p.path.calls.length===7 && !p.workspace.active);await page.evaluate(()=>p.workspace.view.settled());
  const recovered=await page.evaluate(async()=>{const call=p.path.calls.at(-1),rows=await p.engine.list(p.doc.id),scope=JSON.parse(call.request.document);return {target:call.target,action:JSON.parse(call.request.task.split('\n')[1]).action,selected:scope.blocks.find(b=>b.selected).selected,latest:rows[0].status,failed:rows[1].status};});
  assert.equal(recovered.target.model,'sonnet');assert.equal(recovered.action,'Translate');assert.deepEqual(recovered.selected,[{start:0,end:7,text:'Selecte'}]);assert.equal(recovered.latest,'completed');assert.equal(recovered.failed,'invalid');assert.equal(await fixture.getByRole('button',{name:'Retry with default model',exact:true}).isVisible(),false);
  report.checks.manualRetryPreservesSelection=true;assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await context.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/passage-recovery.json',JSON.stringify(report,null,2)+'\n');}
});

test('E: packaged panel/settings themes, all streaming views, keyboard inspection, versions, RTL/fonts and accessibility',async()=>{
 const {profile,context}=await start(),report={checks:{},a11y:{},errors:[]};
 try{
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/ui/panel.html');await page.locator('#state-connect').waitFor();
  for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});report.a11y['panel-connect-'+theme]=await axe(page);assert.deepEqual(report.a11y['panel-connect-'+theme].violations,[]);}
  const settings=await context.newPage();settings.on('pageerror',e=>report.errors.push(e.message));await settings.goto(base+'/ui/settings.html');await settings.locator('#theme-choices input').first().waitFor({state:'attached'});
  for(const theme of ['light','dark']){await settings.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});for(const section of ['connection','models','reading','lenses','sites','appearance','data']){await settings.evaluate(name=>{location.hash=name;},section);await settings.locator('section[data-section='+section+']').waitFor({state:'visible'});const key='settings-'+section+'-'+theme;report.a11y[key]=await axe(settings);assert.deepEqual(report.a11y[key].violations,[],key);}}
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
  const chip=name=>page.locator('.lens-bar').getByRole('button',{name,exact:true});await chip('Logic').click();await page.locator('.adjust summary').click();await page.locator('.analysis-controls input[type=number]').fill('200');await page.locator('.analysis-controls').getByRole('button',{name:'Analyze',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-results .finding').length>0 && e.workspace.active);
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length>0 && e.workspace.active);
  report.checks.incrementalMapAndCards=true;
  await page.waitForFunction(()=>!e.workspace.active && document.querySelectorAll('.analysis-results .finding').length===200);
  await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===200);
  report.checks.streaming=await page.evaluate(()=>{e.observer.disconnect();return {...e.workspace.view.metrics,longTasks:e.longTasks,maxTask:Math.max(0,...e.longTasks)};});
  assert.ok(report.checks.streaming.maxRenderMs<100);assert.ok(report.checks.streaming.maxTask<100,JSON.stringify(report.checks.streaming));
  assert.equal(await page.locator('.analysis-results svg[onload]').count(),0);assert.match(await page.locator('.analysis-results').textContent(),/<svg/);
  await page.locator('.analysis-map .map-node').first().focus();await page.keyboard.press('Enter');await page.locator('.finding-inspector').waitFor();assert.match(await page.locator('.finding-inspector').textContent(),/Inferred/);assert.deepEqual(await page.evaluate(()=>e.refs),[]);await page.locator('.finding-inspector .reference').first().click();assert.deepEqual(await page.evaluate(()=>e.refs),[3]);report.checks.keyboardInspection=true;
  for(const current of ['summary','structure','logic','thinking']){
   await chip(current[0].toUpperCase()+current.slice(1)).click();await page.locator('.analysis-controls').getByRole('button',{name:'Analyze',exact:true}).click();await page.waitForFunction(()=>!e.workspace.active && document.querySelector('.run-state').textContent.startsWith('Completed'));await page.evaluate(()=>e.workspace.view.settled());
   if(current==='summary'){assert.equal(await page.locator('.finding.sum').count(),4);assert.equal(await page.locator('.finding.arc').count(),5);}
   if(current==='structure'){await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===2);await page.getByRole('button',{name:'Collapse branch'}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.analysis-map .map-node').length===1);assert.equal(await page.locator('.finding.sec:visible').count(),1);await page.getByRole('button',{name:'Expand branch'}).click();}
   if(current==='logic'){assert.equal(await page.locator('.finding.gap').count(),1);assert.equal(await page.locator('.finding.step').count(),1);}
   if(current==='thinking'){assert.equal(await page.locator('.finding.concept').count(),2);assert.match(await page.locator('.record-group').allTextContents().then(r=>r.join(' ')),/Causal chain/);}
   for(const theme of ['parchment','ink']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);const result=await axe(page);report.a11y[current+'-'+theme]=result;assert.deepEqual(result.violations,[]);}
  }
  report.checks.allPhaseOneViews=true;
  const typography=await page.evaluate(async()=>{await document.fonts.load('16px "Noto Serif"','Oʻqish Ўқиш');await document.fonts.load('16px "Noto Sans Arabic"','القراءة');return {serif:document.fonts.check('16px "Noto Serif"','Oʻqish Ўқиш'),arabic:document.fonts.check('16px "Noto Sans Arabic"','القراءة'),rtl:getComputedStyle(document.querySelector('.finding.facet .reading-text')).direction};});
  assert.ok(typography.serif && typography.arabic);assert.equal(typography.rtl,'rtl');report.checks.typography=typography;
  await page.locator('.analysis-view').screenshot({path:'test-results/e-thinking-ink.png'});await page.evaluate(()=>{document.documentElement.dataset.theme='parchment';});await page.locator('.analysis-view').screenshot({path:'test-results/e-thinking-parchment.png'});
  const saved=await page.evaluate(async()=>{const rows=await e.engine.list(e.doc.id);return {calls:e.path.calls.length,logic:rows.filter(r=>r.lens==='logic').map(r=>r.id)};});
  await page.locator('.workspace-nav').getByRole('button',{name:'History',exact:true}).click();await page.locator('.run-history select').first().selectOption(saved.logic[0]);await page.locator('.run-history select').nth(1).selectOption(saved.logic[1]);await page.getByRole('button',{name:'Compare versions',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.compare-columns>section').length===2);
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
  const toolbar=reader.getByRole('toolbar',{name:'Passage actions'});
  // The text layer fills in after the page is marked rendered, so select again until the toolbar answers.
  for(let attempt=0;attempt<8&&!await toolbar.isVisible();attempt++){await reader.evaluate(()=>{const p=[...document.querySelectorAll('.textLayer span')].find(el=>el.textContent==='Public partici-'),range=document.createRange();if(!p)return;range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));});await toolbar.waitFor({timeout:1500}).catch(()=>{});}
  await toolbar.waitFor();for(const action of ['Explain','Translate','Argument','Define'])assert.ok(await toolbar.getByRole('button',{name:action,exact:true}).isVisible());
  await reader.bringToFront();await toolbar.getByRole('button',{name:'Explain',exact:true}).focus();await reader.keyboard.press('ArrowRight');assert.equal(await reader.evaluate(()=>document.activeElement.textContent),'Translate');await reader.keyboard.press('Escape');assert.equal(await toolbar.isVisible(),false);report.checks.pdfToolbarKeyboard=true;
  assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await context.close();await server.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/e-passages.json',JSON.stringify(report,null,2)+'\n');}
});

test('E review: historical references preserve the reader, inspection stays in the panel, deep links jump and source access can recover',async()=>{
 const {profile,context}=await start(),server=await serveRepository(),report={checks:{},errors:[]};
 try{
  const reader=await context.newPage();reader.on('pageerror',e=>report.errors.push(e.message));await reader.goto(base+'/ui/reader.html');await reader.locator('.workspace-nav').waitFor();
  const management=await context.newPage();await management.goto('chrome://extensions/');await management.evaluate(async({id,origin})=>chrome.developerPrivate.addHostPermission(id,origin+'/*'),{id,origin:server.url});
  await reader.evaluate(origin=>{const b=document.createElement('button');b.id='grant-review';b.onclick=async()=>{window.reviewGrant=await chrome.permissions.request({origins:[origin+'/*']});};document.body.append(b);},server.url);await reader.locator('#grant-review').click();await reader.waitForFunction(()=>window.reviewGrant===true);
  const source=await context.newPage();await source.goto(server.url+'/corpus/fixtures/html/article-en.html');
  const tabId=await reader.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,source.url());await reader.goto(base+'/ui/reader.html?tab='+tabId);await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));
  async function seed(page,label){await installBrowserTestAPI(page);return page.evaluate(async({address,label})=>{
   const {openDocumentStore,AnalysisEngine,FakePath,buildScope}=SharhTest,store=await openDocumentStore();try{
    const row=(await store.listDocuments()).find(d=>d.address===address),doc=await store.getDocument(row.id),text=JSON.stringify({t:'node',id:label,kind:'claim',text:'Finding '+label,refs:[3],basis:'inferred'})+'\n'+JSON.stringify({t:'end'})+'\n';
    const path=new FakePath({scripts:[{text}],wait:async()=>{}}),engine=new AnalysisEngine({store,paths:{fake:path}}),saved=await engine.start({doc,scope:buildScope(doc),target:{path:'fake',provider:'fixture'},lens:'logic'});
    return {id:doc.id,version:doc.version,run:saved.run.id,text:doc.blocks[2].text};
   }finally{store.close();}
  },{address:source.url(),label});}
  const old=await seed(reader,'old');await source.evaluate(()=>{document.title='Updated review article';document.querySelector('article p').append(' Changed after the first extraction.');});
  await reader.locator('#reextract').click();await reader.waitForFunction(()=>document.querySelector('#document-title').textContent==='Updated review article');const current=await seed(reader,'current');assert.notEqual(current.version,old.version);
  await reader.reload();await reader.waitForFunction(()=>document.querySelectorAll('.run-history option').length>=6);await reader.locator('.workspace-nav').getByRole('button',{name:'History',exact:true}).click();await reader.locator('.run-history select').first().selectOption(current.run);await reader.locator('.run-history select').nth(1).selectOption(old.run);await reader.getByRole('button',{name:'Compare versions',exact:true}).click();await reader.waitForFunction(()=>document.querySelectorAll('.compare-columns>section').length===2);
  const oldColumn=reader.locator('.compare-columns>section').nth(1);await oldColumn.locator('.inspect-finding').first().click();await reader.locator('.finding-inspector').waitFor();assert.equal(await reader.locator('#reference-extraction').isVisible(),false);
  await oldColumn.locator('.reference').first().click();await reader.locator('#reference-extraction').waitFor();assert.match(await reader.locator('#reference-extraction').textContent(),new RegExp(old.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(await reader.locator('.version-comparison').isVisible(),true);assert.equal(await reader.locator('.finding-inspector').isVisible(),true);assert.equal(await reader.locator('#reextract').isEnabled(),true);assert.equal(await reader.locator('#document-title').textContent(),'Updated review article');report.checks.historicalReferencePreservesWorkspace=true;
  const panel=await context.newPage();panel.on('pageerror',e=>report.errors.push(e.message));await panel.goto(base+'/ui/panel.html');await panel.locator('button.recent').first().click();await panel.locator('.analysis-results .inspect-finding').first().waitFor();
  const tabs=context.pages().length;await panel.locator('.analysis-results .inspect-finding').first().click();await panel.locator('.finding-inspector').waitFor();assert.equal(context.pages().length,tabs);report.checks.inspectionDoesNotNavigate=true;
  const opened=context.waitForEvent('page');await panel.locator('.finding-inspector .reference').first().click();const linked=await opened;await linked.waitForFunction(()=>document.querySelector('#text-blocks [data-n="3"].selected'));assert.match(await linked.locator('#reader-state').textContent(),/Highlighted ¶3/);assert.equal(new URL(linked.url()).searchParams.get('version'),current.version);report.checks.deepLinkHighlightsParagraph=true;await linked.close();
  // A reading of this very tab is open in a second panel when access to its site is lost.
  const panel2=await context.newPage();panel2.on('pageerror',e=>report.errors.push(e.message));await panel2.goto(base+'/ui/panel.html');await panel2.locator('#recents').waitFor();
  const readHere=async()=>{await source.bringToFront();await panel2.waitForFunction(()=>document.querySelector('#h-consent').textContent==='Read this page?');await panel2.evaluate(()=>document.getElementById('read-page').click());await panel2.waitForFunction(()=>!document.querySelector('#state-reading').hidden&&!document.getElementById('read-page').disabled);};
  await readHere();
  await reader.evaluate(origin=>chrome.permissions.remove({origins:[origin+'/*']}),server.url);await management.evaluate(async({id,origin})=>chrome.developerPrivate.removeHostPermission(id,origin+'/*'),{id,origin:server.url});
  await source.bringToFront();await panel2.evaluate(()=>document.getElementById('read-page').click());await panel2.locator('#allow-source').waitFor();assert.match(await panel2.locator('#read-state').textContent(),/Sharh toolbar button/);assert.match(await panel2.locator('#read-state').textContent(),/file URLs/);
  await reader.bringToFront();await reader.locator('#reextract').click();await reader.locator('#allow-source').waitFor();assert.match(await reader.locator('#reader-state').textContent(),/Sharh toolbar button/);
  await management.evaluate(async({id,origin})=>chrome.developerPrivate.addHostPermission(id,origin+'/*'),{id,origin:server.url});
  await reader.bringToFront();await reader.locator('#allow-source').click();await reader.waitForFunction(()=>document.querySelector('#reader-state').textContent.startsWith('Saved locally.'));assert.equal(await reader.locator('#allow-source').isVisible(),false);report.checks.readerSourcePermissionRecovery=true;
  await panel2.bringToFront();await panel2.locator('#allow-source').click();await panel2.waitForFunction(()=>document.querySelector('#allow-source').hidden);assert.equal(await panel2.locator('#allow-source').isVisible(),false);report.checks.sourcePermissionRecovery=true;
  // A grant for the document's site cannot help a tab that moved to another site; recovery stops instead of looping.
  await readHere();
  await source.goto(server.url.replace('127.0.0.1','localhost')+'/corpus/fixtures/html/article-en.html');await source.bringToFront();await panel2.evaluate(()=>document.getElementById('read-page').click());await panel2.locator('#allow-source').waitFor();await panel2.locator('#allow-source').click();
  await panel2.waitForFunction(()=>/different site/.test(document.querySelector('#read-state').textContent));assert.equal(await panel2.locator('#allow-source').isVisible(),false);report.checks.differentSiteStopsRecovery=true;
  assert.equal(await panel.locator('h2').filter({hasText:'Activity'}).count(),0);assert.deepEqual(report.errors,[]);report.passed=true;
 }finally{await context.close();await server.close();await rm(profile,{recursive:true,force:true});await mkdir('test-results',{recursive:true});await writeFile('test-results/e-review.json',JSON.stringify(report,null,2)+'\n');}
});
