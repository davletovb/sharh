import {createAcrossTexts} from './across-texts.mjs';
import {buildScope} from '../../src/documents/scopes.mjs';
import {outputTier,usable} from '../../src/ui/preferences.mjs';
import {runState} from '../../src/paths/diagnostics.mjs';
import {createModelPicker} from './model-picker.mjs';
import {bindAppearance} from './theme.mjs';
import {createAnalysisView,referenceButtons} from './views.mjs';
import {element,button,field,options,uid} from './dom.mjs';
import {PASSAGE_ACTIONS} from '../../src/analysis/lenses.mjs';
import {resultMessage,responseDetails} from '../../src/ui/run-feedback.mjs';
import {createToolkit} from './toolkit.mjs';
import {icon} from './icons.mjs';
import {menuButton,chipGroup} from './components.mjs';
import {DETAIL,DETAIL_LABELS} from '../../src/ui/preferences.mjs';
import {languageName} from '../../src/ui/languages.mjs';
import {restoreScope} from '../../src/toolkit/workflows.mjs';
import {scopeDescriptor} from '../../src/analysis/prompts.mjs';
import {safeURL} from '../../src/analysis/contract.mjs';
import {targetKey} from '../../src/paths/targets.mjs';
export {PASSAGE_ACTIONS};
const LENS_HINTS={summary:'What it says: one line, an abstract and a section-by-section summary.',structure:'How it is built, and what each part does.',logic:'How the argument moves, and where its gaps are.',thinking:'The model of thinking behind it: assumptions, concepts and worldview.',themes:'Themes and codes with excerpts and notes. Add a theoretical frame under Adjust.','meta-reading':'What kind of text this is, and where it stands.',critique:'How strong it is: strengths, weak points and counterarguments.',literature:'Whom the text cites and how, and the debate it enters.',terms:'The terms you need, each with a translation and its meaning here.',questions:'Questions to check you could explain it back.',situate:'Where it sits in the wider conversation. Uses web search and links its sources.'};
function openSettingsPage(section='connection') {
  if(!globalThis.chrome?.tabs?.create)return;
  return chrome.tabs.create({url:chrome.runtime.getURL('ui/settings.html#'+section)});
}
export async function createWorkspace(container,{store,engine,client,storage=chrome.storage.local,changes=chrome.storage.onChanged,surface='panel',onReference=()=>{},onOpenDocument=()=>{},onControlsChanged=()=>{},onOpenSettings=openSettingsPage}) {
  let doc=null,scope=null,selectedRun=null,view=null,epoch=0,controller=null,runId=null,preview=null,modelPicker,appearance,loading=0,viewDoc=null,toolkit,previewRevision=0,across,bookGlossary=[];const customMap=new Map();let sourceViewport={numbers:[],source:null};
  const root=element('section','','workspace');root.dataset.surface=surface;
  // The header names what is being read, with what, and how. Models and languages are changed in Settings only.
  const heading=element('header','','doc-header'),title=element('h2','Choose a document','workspace-title'),size=element('p','','scope-estimate');
  const scopeHost=element('div','','scope-host'),scopeLabel=element('span','No scope selected.','scope-label');scopeHost.hidden=surface!=='tab';
  const scopeChip=button('',()=>{scopeHost.hidden=!scopeHost.hidden;scopeChip.setAttribute('aria-expanded',String(!scopeHost.hidden));},'chip');scopeChip.setAttribute('aria-expanded',String(!scopeHost.hidden));scopeChip.append(scopeLabel,icon('chevron',{size:14}));
  const modelChip=button('',()=>onOpenSettings('models'),'chip static'),languageChip=button('',()=>onOpenSettings('reading'),'chip static'),chips=element('div','','chips doc-chips');
  chips.append(scopeChip,modelChip,languageChip);heading.append(title,chips,size,scopeHost);
  // Settings own the theme, language and model. The controls that apply them stay out of sight but live.
  const parked=element('div'),appearanceHost=parked,modelBody=element('div','','control-grid');parked.hidden=true;parked.append(modelBody);
  root.append(heading,parked);container.append(root);
  const nav=element('nav','','workspace-nav');nav.setAttribute('aria-label','Reading workspace');const areas={};
  for(const label of ['Analyze','Ask','History',...(surface==='tab'?['Library']:[])]) {
    const key=label.toLowerCase(),area=element('div','','workspace-area'),tab=button(label,()=>openArea(key));tab.id=uid('area-button');area.id=uid('area');tab.setAttribute('aria-controls',area.id);area.setAttribute('aria-labelledby',tab.id);area.setAttribute('role','region');nav.append(tab);areas[key]={area,tab};
  }
  root.append(nav,...Object.values(areas).map(v=>v.area));
  function openArea(key){if(!areas[key])key='analyze';for(const [name,v]of Object.entries(areas)){v.area.hidden=name!==key;v.tab.setAttribute('aria-pressed',String(name===key));}if(key==='library'){library().catch(fail);across?.refresh().catch(fail);}}
  const controls=element('div','','analysis-controls'),lens=element('select'),budget=element('input'),focus=element('textarea'),frame=element('textarea');
  const builtins=[['summary','Summary'],['structure','Structure'],['logic','Logic'],['thinking','Thinking'],['themes','Themes'],['meta-reading','Meta-reading'],['critique','Critique'],['literature','Literature'],['terms','Terms'],['questions','Questions'],['situate','Situate · web search']];options(lens,builtins);budget.type='number';budget.min=1;budget.max=200;budget.value=DETAIL.standard;focus.maxLength=frame.maxLength=4000;focus.rows=frame.rows=2;
  const lensNames=()=>new Map([...lens.options].map(o=>[o.value,o.textContent]));
  const analyze=button('Analyze',()=>run()),stop=button('Stop',()=>controller?.abort()),resume=button('Continue',()=>continueRun()),freshResume=button('Continue with fresh context',()=>continueRun('new')),retry=button('Retry with default model',()=>retryPassage());
  retry.title='Send the same saved passage and action again as a new run, with your default model.';
  analyze.classList.add('primary');stop.hidden=resume.hidden=freshResume.hidden=retry.hidden=true;
  // Lens: four chips up front, everything else under More. The select stays as the one source of truth.
  const lensHolder=element('div');lensHolder.hidden=true;lensHolder.append(field('Lens',lens));
  const primaryLenses=['summary','structure','logic','thinking'],lensGroup=chipGroup({label:'Lens',choices:primaryLenses.map(v=>[v,builtins.find(b=>b[0]===v)[1]]),onChange:value=>chooseLens(value)});
  const more=menuButton({text:'More',label:'More lenses',className:'chip'}),lensRow=element('div','','chips lens-bar');lensRow.append(lensGroup.root,more.root);
  const lensHint=element('p','','hint lens-hint');
  const detail=chipGroup({label:'Detail',choices:Object.entries(DETAIL_LABELS),onChange:value=>{budget.value=DETAIL[value];budget.dispatchEvent(new budget.ownerDocument.defaultView.Event('change'));}}),adjust=element('details','','adjust'),frameField=field('Theoretical frame (optional)',frame);
  adjust.append(element('summary','Adjust'),element('p','Detail','label-text'),detail.root,field('Number of findings (1–200)',budget),field('Focus (optional)',focus),frameField);
  const actions=element('div','','actions');actions.append(analyze,stop,resume,freshResume,retry);
  controls.append(lensHolder,lensRow,lensHint,adjust,actions);
  const status=element('p','Ready when you are.','run-state');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const diagnostics=element('details','','run-diagnostics');diagnostics.hidden=true;
  const history=element('div','','run-history'),versions=element('select'),compareWith=element('select'),compare=button('Compare versions',()=>compareRuns()),historyLabel=field('Saved readings',versions),compareLabel=field('Compare with',compareWith);
  history.append(historyLabel,button('Open reading',()=>openArea('analyze')),compareLabel,compare);
  const runMeta=element('p','','run-metadata'),results=element('div','','analysis-results'),inspection=element('aside','','finding-inspector');inspection.setAttribute('aria-label','Finding inspection');inspection.hidden=true;
  const resultHead=element('div','','result-head'),resultMenu=menuButton({label:'Reading actions',iconName:'more'});resultHead.hidden=true;resultHead.append(runMeta,resultMenu.root);
  const comparison=element('section','','version-comparison');comparison.hidden=true;
  areas.analyze.area.append(controls,status,diagnostics,resultHead,results);
  // The finding inspector sits below every area, so it appears beside a reading or a comparison alike.
  root.append(inspection);
  areas.history.area.append(element('h3','History'),element('p','Every reading is saved with its text, so reopening it costs nothing.','hint'),history,comparison);
  areas.ask.area.append(element('h3','Ask about your text'),element('p','Grounded conversation is coming soon. You can already select a passage and choose Explain, Translate, Logic or Define.'),button('Analyze this scope',()=>openArea('analyze')));
  const documents=element('div','','library-documents');areas.library?.area.append(element('h3','Saved documents'),element('p','Documents and their reading history stay on this computer. Open a document to see its saved readings.','hint'),documents);
  root.addEventListener('sharh:error',event=>{event.stopPropagation();fail(event.detail);});
  function fail(error){status.textContent=error.hint??error.message??String(error);}
  function targetName(target){return `${target?.provider??'No provider'} · ${target?.model || 'provider default'}${target?.effort?' · '+target.effort:''}${target?.serviceTier?' · '+target.serviceTier:''}`;}
  function configuration(extra={}) {
    return {doc,scope,target:modelPicker.target,lens:lens.value==='situate'?'literature':lens.value,...(lens.value==='situate'?{operation:'situate'}:{}),customLens:customMap.get(lens.value)??null,language:appearance.value.language,budget:Number(budget.value),glossary:bookGlossary,focus:focus.value,frame:frame.value,
      tier:outputTier(modelPicker.tier),persistent:modelPicker.info?.capabilities?.sessions===true,...extra};
  }
  async function runConfiguration(extra={}) {
    const config=configuration(extra),tier=extra.tier===undefined?(config.customLens?.tier??(['terms','questions'].includes(config.lens)?'quick':null)):null;
    if(!tier)return config;
    const picked=await modelPicker.forTier(tier);return {...config,target:picked.target,tier:outputTier(tier),persistent:picked.info.capabilities?.sessions===true};
  }
  async function updatePreview() {
    const ticket=++previewRevision;preview=null;scopeLabel.textContent=scope?scope.label:'No scope selected.';analyze.disabled=true;
    try {
      if(doc && scope && modelPicker && appearance){const config=await runConfiguration();if(ticket!==previewRevision)return;preview=engine.preview(config);size.textContent=`≈${preview.estimatedTokens.toLocaleString()} tokens`;size.title=`${preview.requestBytes.toLocaleString()} of ${preview.maxRequestBytes.toLocaleString()} bytes`;showModel(config.target);if(!preview.fits)status.textContent=preview.hint;}
      else{size.textContent='';size.title='';}
    }catch(error){if(ticket!==previewRevision)return;fail(error);size.textContent='';}
    analyze.disabled=!!controller || !preview?.fits || !usable(modelPicker?.info);
    retry.disabled=!!controller || !usable(modelPicker?.info);
  }
  let glossaryLanguage=null;
  const providerName=info=>info?.label??info?.provider??'No model';
  function showModel(target){const text=target?`${providerName(modelPicker?.info)} · ${target.model||'default'}${target.effort?' · '+target.effort:''}`:'No model chosen';modelChip.textContent=text;modelChip.setAttribute('aria-label',`Model: ${text}. Change it in Settings.`);}
  function showChips(){if(!appearance)return;languageChip.textContent=languageName(appearance.value.language);languageChip.setAttribute('aria-label',`Answer language: ${languageName(appearance.value.language)}. Change it in Settings.`);}
  function chooseLens(value){lens.value=value;lens.dispatchEvent(new lens.ownerDocument.defaultView.Event('change'));}
  function syncLens(){
    const names=lensNames(),value=lens.value,primary=primaryLenses.includes(value);lensGroup.select(primary?value:null);more.button.classList.toggle('selected',!primary);more.setLabel(primary?'More':names.get(value)??value);
    lensHint.textContent=LENS_HINTS[value]??(value.startsWith('custom:')?(customMap.get(value)?.instructions?.slice(0,160)??'Your own lens.'):'');frameField.hidden=value!=='themes';
    more.setItems([...[...names].filter(([v])=>!primaryLenses.includes(v)).map(([v,t])=>({label:t,action:()=>chooseLens(v)})),'-',{label:'Deep read (Structure, Logic, Thinking)',action:()=>toolkit.deepRead(),get disabled(){return !!controller;}},{label:'Second reading with your partner model (Themes or Logic)',action:()=>toolkit.readTwice(),get disabled(){return !['themes','logic'].includes(lens.value) || !!controller;}}]);
  }
  function changed(){showChips();try{showModel(modelPicker.target);}catch{showModel(null);}if(across&&glossaryLanguage!==appearance.value.language)across.refreshGlossary().catch(fail);else updatePreview();onControlsChanged();}
  let shownDetail=null;
  const followSettings=()=>{if(!appearance)return;const next=appearance.value.detail;if(next!==shownDetail){shownDetail=next;budget.value=DETAIL[next];}detail.select(Object.entries(DETAIL).find(([,n])=>n===Number(budget.value))?.[0]??null);modelPicker?.setTier(modelPicker.tier);};
  appearance=await bindAppearance(appearanceHost,{storage,changes,onChange:()=>{if(appearance){followSettings();changed();}}});
  modelPicker=await createModelPicker(modelBody,{client,storage,onChange:()=>{if(modelPicker)changed();}});
  const ready=modelPicker.ready.then(changed);
  for(const control of [budget,focus,frame])control.addEventListener('change',()=>{detail.select(Object.entries(DETAIL).find(([,n])=>n===Number(budget.value))?.[0]??null);changed();});followSettings();
  lens.addEventListener('change',()=>{syncLens();changed();});syncLens();
  function reference(n,source=viewDoc??doc,originalN=null){const block=source?.blocks.find(b=>b.n===n);if(!block){fail(Error('This paragraph is not in the saved extraction.'));return;}Promise.resolve().then(async()=>{if(block.source){const numbers=block.source.refs??[block.source.n],chosen=originalN??block.source.n;if(!numbers.includes(chosen))throw Error('This paragraph is not cited by the saved evidence.');const original=await store.getDocument(block.source.docId,block.source.version),paragraph=original?.blocks.find(b=>b.n===chosen);if(!paragraph)throw Error('The original source was deleted.');return onReference(paragraph,original);}return onReference(block,source);}).catch(fail);}
  function inspect(entry,source=viewDoc??doc) {
    const r=entry.record;inspection.replaceChildren(element('h3',r.title??r.term??'Inspect finding'),element('p',r.text??r.gist??r.gloss??''));inspection.hidden=false;
    if(r.basis)inspection.append(element('p',r.basis==='inferred'?'Inferred · reconstructed by the model':'Stated · presented as stated in the text','basis '+r.basis));
    for(const n of (r.refs??[]).slice(0,4)){const block=source?.blocks.find(b=>b.n===n);if(block){const quote=element('blockquote',block.text);quote.dir='auto';inspection.append(element('strong',`¶${n}${block.pageLabel?' · p. '+block.pageLabel:''}`),quote);}}
    inspection.append(referenceButtons(source,r,(n,original)=>reference(n,source,original)));
  }
  const viewLens=(lensName,customLens)=>lensName.startsWith('custom:')?(customLens?.types.includes('sec')?'structure':customLens?.types.includes('concept')?'thinking':customLens?.types.includes('node')?'logic':lensName):lensName;
  function newView(lensName,source,customLens=null) {view?.dispose();viewDoc=source;results.replaceChildren();view=createAnalysisView(results,{lens:viewLens(lensName,customLens),doc:source,onReference:(n,original)=>reference(n,source,original),onInspect:entry=>inspect(entry,source)});applyViewport(view);return view;}
  function applyViewport(current){const {source,numbers}=sourceViewport;current.setVisibleParagraphs(source?.docId===current.source.docId&&source?.version===current.source.version?numbers:[]);}
  function metadata(run){return `${run.config?.customLens?.name??run.config?.operation??run.lens} · v${run.version} · ${run.status}${run.stale?' · older extraction':''}${run.config?.digests&&new Set(run.config.digests.map(d=>targetKey(d.target))).size>1?' · mixed digest targets':''} · ${targetName(run.target)} · ${run.scope.label}${run.config?.frame?' · frame: '+run.config.frame:''} · ${new Date(run.createdAt).toLocaleString()}`;}
  function feedback(saved,{loaded=false}={}) {
    status.textContent=resultMessage(saved.run,saved.records.length,{loaded});
    retry.hidden=!saved.run.config?.action || !['invalid','failed','interrupted'].includes(saved.run.status);
    const lines=responseDetails(saved.run);diagnostics.replaceChildren(element('summary','Response details'),...lines.map(text=>element('p',text)));
    diagnostics.hidden=(!lines.length && retry.hidden) || saved.run.status==='completed';
    if(!retry.hidden)diagnostics.append(element('p','Passage actions use your quick-help model. Retry sends this saved selection again with your default model. Change models in Settings → Models.'));
    results.querySelector('.search-sources')?.remove();if(saved.run.config?.operation==='situate' && saved.run.sources?.length){const sources=element('section','','search-sources');sources.append(element('h3','Returned search sources'));for(const source of saved.run.sources){const url=safeURL(source.url);if(!url)continue;const a=element('a',source.title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';sources.append(a,element('p',source.snippet));}results.append(sources);}
  }
  async function savedRuns({select=selectedRun?.run.id,display=false}={}) {
    const snapshot=doc,ticket=++loading;if(!snapshot)return;
    const rows=await engine.list(snapshot.id);if(snapshot!==doc || ticket!==loading)return;
    const compared=compareWith.value,choices=rows.map(r=>[r.id,metadata(r)]);options(versions,[['','Choose a saved reading'],...choices]);options(compareWith,[['','Choose another reading'],...choices]);
    if(rows.some(r=>r.id===select))versions.value=select;else if(rows.length && display)versions.value=rows[0].id;
    if(rows.some(r=>r.id===compared))compareWith.value=compared;
    compare.disabled=rows.length<2;history.hidden=!rows.length;
    if(display && versions.value)await loadRun(versions.value);
  }
  async function loadRun(id) {
    if(controller)return;const snapshot=doc,stamp=epoch,saved=await engine.repository.get(id);if(!saved || stamp!==epoch || saved.run.docId!==snapshot?.id)return;
    const source=await store.getDocument(snapshot.id,saved.run.extractionVersion);if(stamp!==epoch || !source)return;
    selectedRun=saved;newView(saved.run.lens,source,saved.run.config?.customLens);for(const entry of saved.records)view.record(entry);runMeta.textContent=metadata(saved.run);resultHead.hidden=false;
    resume.hidden=freshResume.hidden=!(saved.run.canContinue!==false && saved.run.metrics?.truncated && !saved.run.continuedBy && saved.run.status!=='running');
    feedback(saved,{loaded:true});inspection.hidden=true;comparison.hidden=true;
  }
  versions.addEventListener('change',()=>loadRun(versions.value).catch(fail));
  async function work(operation,lensName,source,{area='analyze',customLens=null}={}) {
    if(!source)throw Error('Open a document and choose its scope first.');
    if(controller)throw Error('Stop the current run before starting another.');const stamp=epoch,abort=new AbortController(),chat=area==='ask';controller=abort;runId=null;if(!chat)selectedRun=null;
    let sink=chat?null:newView(lensName,source,customLens);openArea(area);if(!chat){resultHead.hidden=false;inspection.hidden=true;comparison.hidden=true;diagnostics.hidden=true;resume.hidden=freshResume.hidden=retry.hidden=true;stop.hidden=false;runMeta.textContent='';status.textContent='Connecting…';}
    for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=true;modelPicker.setDisabled(true);history.inert=true;analyze.disabled=true;
    try {
      const saved=await operation({signal:abort.signal,onLens:name=>{if(stamp===epoch&&!chat)sink=newView(name,source);},onEvent:event=> {
        if(stamp!==epoch)return;if(event.type==='run' && event.status==='running')runId=event.runId;
        if(event.type==='record')sink?.record(event.entry);if(event.type==='reset')sink?.reset();
        if(chat)return;
        const state=runState(event);if(state)status.textContent=state;
        if(event.type==='repairing')status.textContent='Checking the partial response…';if(event.type==='session_reset')status.textContent='Session expired. Sending this scope again.';
      }});
      if(stamp!==epoch||chat)return saved;selectedRun=saved;sink.reset();for(const entry of saved.records)sink.record(entry);
      runMeta.textContent=metadata(saved.run);feedback(saved);
      resume.hidden=freshResume.hidden=!(saved.run.canContinue && !saved.run.continuedBy);return saved;
    }catch(error){if(stamp===epoch&&!chat){fail(error);if(error.runId){selectedRun=await engine.repository.get(error.runId);if(selectedRun){runMeta.textContent=metadata(selectedRun.run);feedback(selectedRun);resume.hidden=freshResume.hidden=!(selectedRun.run.canContinue && !selectedRun.run.continuedBy);}}}throw error;}
    finally{if(controller===abort){controller=null;stop.hidden=true;for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=false;modelPicker.setDisabled(false);history.inert=false;updatePreview();if(stamp===epoch){await savedRuns({select:selectedRun?.run.id});await across?.refreshGlossary();}}}
  }
  async function run(extra={},startOptions={}) {
    await ready;if(!usable(startOptions.providerInfo??modelPicker.info))throw Error('Choose a signed-in, accepted provider with tool isolation, or open Seatline settings.');
    if(!doc || !scope)throw Error('Open a document and choose its scope first.');if(extra.budget===undefined && !budget.reportValidity())throw Error('Choose a number of findings from 1 to 200.');
    const config=await runConfiguration(extra);const measured=engine.preview(config);if(!measured.fits)throw Error(measured.hint);
    if(config.operation==='situate' && !modelPicker.info?.capabilities?.webSearch)throw Error('This provider does not advertise web search. Choose a search-capable provider for Situate.');
    return work(opts=>across.run(config,{...opts,...startOptions}),config.lens,doc,{customLens:config.customLens});
  }
  async function continueRun(mode='auto') {
    if(!selectedRun)throw Error('Choose a partial run.');const id=selectedRun.run.id,preview=await engine.previewContinuation(id,{mode});
    if(!preview.fits)throw Error(preview.hint);const source=await store.getDocument(doc.id,selectedRun.run.extractionVersion);
    return work(opts=>engine.continue(id,{...opts,mode}),selectedRun.run.lens,source,{customLens:selectedRun.run.config?.customLens});
  }
  async function retryPassage() {
    await ready;if(controller)throw Error('Stop the current run before starting another.');
    const prior=selectedRun?.run,stamp=epoch;
    if(!prior?.config?.action || !['invalid','failed','interrupted'].includes(prior.status))throw Error('Choose a failed passage run first.');
    const main=await modelPicker.forTier('analysis');if(!usable(main.info))throw Error('Choose a signed-in, accepted provider first.');
    const target=main.target,tier='analysis',persistent=main.info.capabilities?.sessions===true;
    const source=await store.getDocument(prior.docId,prior.extractionVersion);
    if(stamp!==epoch || selectedRun?.run.id!==prior.id)throw Error('The selected run changed. Choose it again.');
    if(!source)throw Error('The saved extraction was deleted. Select the passage again.');
    const spans=prior.scope.blocks.flatMap(b=>(b.selected??[]).map(span=>({n:b.n,...span}))),chosen=buildScope(source,{kind:'selection',spans});
    const config={...prior.config,doc:source,scope:chosen,target,tier,persistent},measured=engine.preview(config);
    if(!measured.fits)throw Error(measured.hint);
    return work(opts=>engine.start(config,{...opts,allowSavedExtraction:true}),config.lens,source);
  }
  let compareViews=[];
  async function compareRuns() {
    if(controller)return;if(!versions.value || !compareWith.value || versions.value===compareWith.value)throw Error('Choose two different saved runs.');
    const stamp=epoch,pair=await Promise.all([versions.value,compareWith.value].map(id=>engine.repository.get(id)));if(stamp!==epoch || pair.some(v=>!v || v.run.docId!==doc.id))return;
    for(const v of compareViews)v.dispose();compareViews=[];comparison.replaceChildren(element('h3','Compare saved versions'));const columns=element('div','','compare-columns');comparison.append(columns);comparison.hidden=false;
    for(const saved of pair){const source=await store.getDocument(saved.run.docId,saved.run.extractionVersion);if(stamp!==epoch)return;const column=element('section');column.append(element('h4',metadata(saved.run)));columns.append(column);const v=createAnalysisView(column,{lens:viewLens(saved.run.lens,saved.run.config?.customLens),doc:source,onReference:(n,original)=>reference(n,source,original),onInspect:e=>inspect(e,source)});compareViews.push(v);applyViewport(v);for(const e of saved.records)v.record(e);}
  }
  async function library() {
    const rows=(await store.listDocuments()).filter(d=>!d.derived);documents.replaceChildren();if(!rows.length)documents.append(element('p','Your saved documents will appear here.'));
    for(const item of rows){const card=element('article');card.append(element('h4',item.title),element('p',[item.kind.toUpperCase(),item.updatedAt?new Date(item.updatedAt).toLocaleDateString():null].filter(Boolean).join(' · ')),button('Open saved document',()=>onOpenDocument(item.id)));documents.append(card);}
  }
  openArea('analyze');history.hidden=true;updatePreview();
  // Library work, whole-book jobs, the glossary and custom lenses belong to the full tab. The side panel keeps them
  // loaded but out of sight, so its readings still use the glossary and failover settings.
  const toolsHost=surface==='tab'?areas.library.area:element('div');
  toolkit=await createToolkit({analyze:toolsHost,ask:areas.ask.area,pairs:areas.history.area,root,store,engine,client,storage,api:{discovery:modelPicker.ready.then(()=>modelPicker.providers),state:()=>({doc,scope}),configuration,active:()=>!!controller,cancel:()=>controller?.abort(),work,fail,reference,showSaved:loadRun,openArea,selected:()=>selectedRun,view:()=>view,
    customChanged:definitions=>{const chosen=lens.value;customMap.clear();for(const d of definitions)customMap.set('custom:'+d.id,d);options(lens,[...builtins,...definitions.map(d=>['custom:'+d.id,d.name])]);if([...lens.options].some(o=>o.value===chosen))lens.value=chosen;syncLens();updatePreview();},
    chooseLens,
    studio:async({chatId,area,chatContext,pairId})=>{if(!doc)throw Error('Open a document first.');if(!globalThis.chrome?.tabs)throw Error('Studio opens in the installed extension.');const id=crypto.randomUUID(),shown=area==='ask'?null:selectedRun?.run,source=area==='ask'&&chatContext?chatContext.doc:shown?await store.getDocument(shown.docId,shown.extractionVersion):doc,chosen=area==='ask'&&chatContext?chatContext.scope:shown?restoreScope(source,shown.scope):scope;await chrome.storage.session.set({['sharh:studio:'+id]:{docId:source.id,version:source.version,runId:shown?.id,scope:chosen?scopeDescriptor(chosen):null,compareId:!comparison.hidden?compareWith.value:null,chatId,area,pairId}});await chrome.tabs.create({url:chrome.runtime.getURL('ui/reader.html?studio='+id)});}}});
  across=await createAcrossTexts({library:surface==='tab'?areas.library.area:element('div'),analyze:toolsHost,modelHost:surface==='tab'?toolsHost:modelBody,dialogHost:root,store,engine,storage,api:{state:()=>({doc,scope}),configuration,language:()=>appearance.value.language,currentTier:()=>modelPicker.tier,forTier:tier=>modelPicker.forTier(tier),active:()=>!!controller,work,fail,refreshRuns:()=>savedRuns(),glossaryChanged:rows=>{bookGlossary=rows;glossaryLanguage=appearance.value.language;updatePreview();},openDocument:onOpenDocument,openItem:item=>onOpenDocument(item.docId,item.version,item.scope),openArea,maintenance:()=>client.call('maintenance').catch(()=>{})}});
  const isMap=()=>!!selectedRun && ['structure','logic','thinking'].includes(viewLens(selectedRun.run.lens,selectedRun.run.config?.customLens));
  resultMenu.setItems([
    {label:'Export as Markdown',action:()=>toolkit.exportRun('markdown'),get disabled(){return !selectedRun;}},
    {label:'Export as JSON archive',action:()=>toolkit.exportRun('json'),get disabled(){return !selectedRun;}},
    {label:'Export map as SVG',action:()=>toolkit.exportRun('svg'),get hidden(){return !isMap();}},
    {label:'Export map as PNG',action:()=>toolkit.exportRun('png'),get hidden(){return !isMap();}},
    '-',
    {label:'Open in full tab',action:()=>toolkit.studio(),get hidden(){return surface==='tab';}}
  ]);
  return {ready,run,scopeHost,openArea,openStudio:()=>toolkit.studio(),async setDocument(value){epoch++;loading++;controller?.abort();doc=value;bookGlossary=[];scope=value?buildScope(value):null;selectedRun=null;title.textContent=value?.title??'Choose a document';inspection.hidden=true;comparison.hidden=true;diagnostics.hidden=true;for(const v of compareViews)v.dispose();compareViews=[];view?.dispose();view=null;results.replaceChildren();runMeta.textContent='';resultHead.hidden=true;resume.hidden=freshResume.hidden=retry.hidden=true;updatePreview();if(value)await savedRuns({display:true});else history.hidden=true;await toolkit.setDocument();await across.setDocument();},
    setScope(value){scope=value;toolkit.scopeChanged(value);updatePreview();},measureScope(value,chosen){try{return engine.preview({...configuration(),doc:value,scope:chosen});}catch{return null;}},
    async passage(action,selection,{intentId,onAccepted}={}){
      if(controller)throw Error('Stop the current run before starting another.');
      if(action==='Ask about this'){await ready;return toolkit.askSelection({...configuration(),scope:buildScope(doc,{kind:'selection',spans:selection.spans})},{intentId,onAccepted});}
      if(!Object.hasOwn(PASSAGE_ACTIONS,action))throw Error('Unknown passage action.');await ready;
      const passageScope=buildScope(doc,{kind:'selection',spans:selection.spans}),quick=await modelPicker.forTier('quick'),lensName=action==='Logic'?'logic':'passage';
      return run({scope:passageScope,target:quick.target,tier:'quick',persistent:quick.info.capabilities?.sessions===true,budget:24,lens:lensName,action,focus:'',operation:null,customLens:null},
        {providerInfo:quick.info,allowSavedExtraction:true,onBegin:async run=>{if(intentId)await engine.repository.write(run.id,{passageIntentId:intentId});await onAccepted?.(run);}});
    },
    openSaved:loadRun,openChat:toolkit.openChat,
    visibleParagraphs(numbers,source){sourceViewport={numbers:[...numbers],source};for(const current of [view,...compareViews].filter(Boolean))applyViewport(current);toolkit.visibleParagraphs(numbers,source);},
    async restoreStudio(intent){if(intent.scope?.docId===doc?.id && intent.scope.version===doc?.version){scope=restoreScope(doc,intent.scope);updatePreview();}if(intent.runId)await loadRun(intent.runId);if(intent.compareId){versions.value=intent.runId;compareWith.value=intent.compareId;await compareRuns();}if(intent.chatId)await toolkit.openChat(intent.chatId);if(intent.pairId)await toolkit.openPair(intent.pairId);openArea(intent.area??'analyze');},
    get document(){return doc;},get selectionScope(){return scope;},get target(){return modelPicker.target;},get active(){return !!controller;},get view(){return view;},
    dispose(){epoch++;previewRevision++;controller?.abort();toolkit.dispose();across.dispose();view?.dispose();for(const v of compareViews)v.dispose();modelPicker.dispose();appearance.dispose();root.remove();}};
}
