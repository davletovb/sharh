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
import {restoreScope} from '../../src/toolkit/workflows.mjs';
import {scopeDescriptor} from '../../src/analysis/prompts.mjs';
import {safeURL} from '../../src/analysis/contract.mjs';
export {PASSAGE_ACTIONS};
export async function createWorkspace(container,{store,engine,client,storage=chrome.storage.local,changes=chrome.storage.onChanged,onReference=()=>{},onOpenDocument=()=>{},onControlsChanged=()=>{}}) {
  let doc=null,scope=null,selectedRun=null,view=null,epoch=0,controller=null,runId=null,preview=null,modelPicker,appearance,loading=0,viewDoc=null,toolkit;const customMap=new Map();
  const root=element('section','','workspace'),heading=element('header'),title=element('h2','Choose a document','workspace-title'),scopeLabel=element('p','No scope selected.','scope-label'),size=element('p','','scope-estimate');
  heading.append(title,scopeLabel,size);const appearanceHost=element('div','','appearance-controls'),modelHost=element('details','','model-picker'),modelSummary=element('summary','Model and task tier'),modelBody=element('div','','control-grid');modelHost.append(modelSummary,modelBody);
  root.append(heading,appearanceHost,modelHost);container.append(root);
  const nav=element('nav','','workspace-nav');nav.setAttribute('aria-label','Reading workspace');const areas={};
  for(const label of ['Analyze','Ask','Library']) {
    const key=label.toLowerCase(),area=element('div','','workspace-area'),tab=button(label,()=>openArea(key));tab.id=uid('area-button');area.id=uid('area');tab.setAttribute('aria-controls',area.id);area.setAttribute('aria-labelledby',tab.id);area.setAttribute('role','region');nav.append(tab);areas[key]={area,tab};
  }
  root.append(nav,...Object.values(areas).map(v=>v.area));
  function openArea(key){for(const [name,v]of Object.entries(areas)){v.area.hidden=name!==key;v.tab.setAttribute('aria-pressed',String(name===key));}if(key==='library')library().catch(fail);}
  const controls=element('div','','analysis-controls'),lens=element('select'),budget=element('input'),focus=element('textarea'),frame=element('textarea');
  const builtins=[['summary','Summary'],['structure','Structure'],['logic','Logic'],['thinking','Thinking'],['themes','Themes'],['meta-reading','Meta-reading'],['critique','Critique'],['literature','Literature'],['terms','Terms'],['questions','Questions'],['situate','Situate · web search']];options(lens,builtins);budget.type='number';budget.min=1;budget.max=200;budget.value=24;focus.maxLength=frame.maxLength=4000;focus.rows=frame.rows=2;
  const analyze=button('Analyze',()=>run()),stop=button('Stop',()=>controller?.abort()),resume=button('Continue',()=>continueRun()),freshResume=button('Continue with fresh context',()=>continueRun('new')),retry=button('Retry with selected model',()=>retryPassage());
  retry.title='Send the same saved passage and action as a new run using the model selected above.';
  analyze.classList.add('primary');stop.hidden=resume.hidden=freshResume.hidden=retry.hidden=true;
  controls.append(field('Lens',lens),field('Record budget',budget),field('Focus (optional)',focus),field('Theoretical frame (optional)',frame),analyze,stop,resume,freshResume,retry);
  const status=element('p','Choose a scope and model.','run-state');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const diagnostics=element('details','','run-diagnostics');diagnostics.hidden=true;
  const history=element('div','','run-history'),versions=element('select'),compareWith=element('select'),compare=button('Compare versions',()=>compareRuns()),historyLabel=field('Saved runs',versions),compareLabel=field('Compare with',compareWith);
  history.append(historyLabel,compareLabel,compare);
  const runMeta=element('p','','run-metadata'),results=element('div','','analysis-results'),inspection=element('aside','','finding-inspector');inspection.setAttribute('aria-label','Finding inspection');inspection.hidden=true;
  const comparison=element('section','','version-comparison');comparison.hidden=true;
  areas.analyze.area.append(controls,status,diagnostics,history,runMeta,results,inspection,comparison);
  areas.ask.area.append(element('h3','Ask about your text'),element('p','Grounded conversation is coming soon. You can already select a passage and choose Explain, Translate, Logic or Define.'),button('Analyze this scope',()=>openArea('analyze')));
  const documents=element('div','','library-documents');areas.library.area.append(element('h3','Saved documents'),element('p','Documents and their reading history stay on this computer. Open a document to see its saved runs.'),documents);
  root.addEventListener('sharh:error',event=>{event.stopPropagation();fail(event.detail);});
  function fail(error){status.textContent=error.hint??error.message??String(error);}
  function targetName(target){return `${target?.provider??'No provider'} · ${target?.model || 'provider default'}${target?.effort?' · '+target.effort:''}${target?.serviceTier?' · '+target.serviceTier:''}`;}
  function configuration(extra={}) {
    return {doc,scope,target:modelPicker.target,lens:lens.value==='situate'?'literature':lens.value,...(lens.value==='situate'?{operation:'situate'}:{}),customLens:customMap.get(lens.value)??null,language:appearance.value.language,budget:Number(budget.value),focus:focus.value,frame:frame.value,
      tier:outputTier(modelPicker.tier),persistent:modelPicker.info?.capabilities?.sessions===true,...extra};
  }
  function updatePreview() {
    preview=null;scopeLabel.textContent=scope?scope.label:'No scope selected.';
    try {
      if(doc && scope && modelPicker && appearance){preview=engine.preview(configuration());size.textContent=`≈${preview.estimatedTokens.toLocaleString()} tokens · ${preview.requestBytes.toLocaleString()} / ${preview.maxRequestBytes.toLocaleString()} bytes · ${targetName(modelPicker.target)}`;if(!preview.fits)status.textContent=preview.hint;}
      else size.textContent='';
    }catch(error){fail(error);size.textContent='';}
    analyze.disabled=!!controller || !preview?.fits || !usable(modelPicker?.info);
    retry.disabled=!!controller || !usable(modelPicker?.info);
  }
  function changed(){updatePreview();onControlsChanged();}
  appearance=await bindAppearance(appearanceHost,{storage,changes,onChange:()=>{if(appearance)changed();}});
  modelPicker=await createModelPicker(modelBody,{client,storage,onChange:()=>{if(modelPicker)changed();}});
  const ready=modelPicker.ready.then(changed);
  for(const control of [budget,focus,frame])control.addEventListener('change',changed);
  lens.addEventListener('change',()=>{analyze.disabled=true;const tier=customMap.get(lens.value)?.tier??(['terms','questions'].includes(lens.value)?'quick':null);Promise.resolve(tier?modelPicker.setTier(tier):null).then(changed).catch(fail);});
  function reference(n,source=viewDoc??doc){const block=source?.blocks.find(b=>b.n===n);if(!block){fail(Error('This paragraph is not in the saved extraction.'));return;}Promise.resolve(onReference(block,source)).catch(fail);}
  function inspect(entry,source=viewDoc??doc) {
    const r=entry.record;inspection.replaceChildren(element('h3',r.title??r.term??'Inspect finding'),element('p',r.text??r.gist??r.gloss??''));inspection.hidden=false;
    if(r.basis)inspection.append(element('p',r.basis==='inferred'?'Inferred · reconstructed by the model':'Stated · presented as stated in the text','basis '+r.basis));
    for(const n of (r.refs??[]).slice(0,4)){const block=source?.blocks.find(b=>b.n===n);if(block){const quote=element('blockquote',block.text);quote.dir='auto';inspection.append(element('strong',`¶${n}${block.pageLabel?' · p. '+block.pageLabel:''}`),quote);}}
    inspection.append(referenceButtons(source,r,n=>reference(n,source)));
  }
  function newView(lensName,source,customLens=null) {view?.dispose();viewDoc=source;results.replaceChildren();const shown=lensName.startsWith('custom:')?(customLens?.types.includes('sec')?'structure':customLens?.types.includes('concept')?'thinking':customLens?.types.includes('node')?'logic':lensName):lensName;view=createAnalysisView(results,{lens:shown,doc:source,onReference:n=>reference(n,source),onInspect:entry=>inspect(entry,source)});return view;}
  function metadata(run){return `${run.config?.customLens?.name??run.config?.operation??run.lens} · v${run.version} · ${run.status}${run.stale?' · older extraction':''} · ${targetName(run.target)} · ${run.scope.label}${run.config?.frame?' · frame: '+run.config.frame:''} · ${new Date(run.createdAt).toLocaleString()}`;}
  function feedback(saved,{loaded=false}={}) {
    status.textContent=resultMessage(saved.run,saved.records.length,{loaded});
    retry.hidden=!saved.run.config?.action || !['invalid','failed','interrupted'].includes(saved.run.status);
    const lines=responseDetails(saved.run);diagnostics.replaceChildren(element('summary','Response details'),...lines.map(text=>element('p',text)));
    diagnostics.hidden=(!lines.length && retry.hidden) || saved.run.status==='completed';
    if(!retry.hidden)diagnostics.append(element('p','Passage actions use the saved Quick model. Choose a model in “Model and task tier”, then use “Retry with selected model” to send this saved selection again.'));
    results.querySelector('.search-sources')?.remove();if(saved.run.config?.operation==='situate' && saved.run.sources?.length){const sources=element('section','','search-sources');sources.append(element('h3','Returned search sources'));for(const source of saved.run.sources){const url=safeURL(source.url);if(!url)continue;const a=element('a',source.title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';sources.append(a,element('p',source.snippet));}results.append(sources);}
  }
  async function savedRuns({select=selectedRun?.run.id,display=false}={}) {
    const snapshot=doc,ticket=++loading;if(!snapshot)return;
    const rows=await engine.list(snapshot.id);if(snapshot!==doc || ticket!==loading)return;
    const choices=rows.map(r=>[r.id,metadata(r)]);options(versions,[['','Choose a saved run'],...choices]);options(compareWith,[['','Choose another run'],...choices]);
    if(rows.some(r=>r.id===select))versions.value=select;else if(rows.length && display)versions.value=rows[0].id;
    compare.disabled=rows.length<2;history.hidden=!rows.length;
    if(display && versions.value)await loadRun(versions.value);
  }
  async function loadRun(id) {
    if(controller)return;const snapshot=doc,stamp=epoch,saved=await engine.repository.get(id);if(!saved || stamp!==epoch || saved.run.docId!==snapshot?.id)return;
    const source=await store.getDocument(snapshot.id,saved.run.extractionVersion);if(stamp!==epoch || !source)return;
    selectedRun=saved;newView(saved.run.lens,source,saved.run.config?.customLens);for(const entry of saved.records)view.record(entry);runMeta.textContent=metadata(saved.run);
    resume.hidden=freshResume.hidden=!(saved.run.canContinue!==false && saved.run.metrics?.truncated && !saved.run.continuedBy && saved.run.status!=='running');
    feedback(saved,{loaded:true});inspection.hidden=true;comparison.hidden=true;
  }
  versions.addEventListener('change',()=>loadRun(versions.value).catch(fail));
  async function work(operation,lensName,source,{area='analyze',customLens=null}={}) {
    if(!source)throw Error('Open a document and choose its scope first.');
    if(controller)throw Error('Stop the current run before starting another.');const stamp=epoch,abort=new AbortController();controller=abort;runId=null;selectedRun=null;
    let sink=newView(lensName,source,customLens);openArea(area);inspection.hidden=true;comparison.hidden=true;diagnostics.hidden=true;resume.hidden=freshResume.hidden=retry.hidden=true;stop.hidden=false;runMeta.textContent='';status.textContent='Connecting…';
    for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=true;modelPicker.setDisabled(true);history.inert=true;analyze.disabled=true;
    try {
      const saved=await operation({signal:abort.signal,onLens:name=>{if(stamp===epoch)sink=newView(name,source);},onEvent:event=> {
        if(stamp!==epoch)return;if(event.type==='run' && event.status==='running')runId=event.runId;
        if(event.type==='record')sink.record(event.entry);if(event.type==='reset')sink.reset();
        const state=runState(event);if(state)status.textContent=state;
        if(event.type==='repairing')status.textContent='Checking the partial response…';if(event.type==='session_reset')status.textContent='Session expired. Sending this scope again.';
      }});
      if(stamp!==epoch)return saved;selectedRun=saved;sink.reset();for(const entry of saved.records)sink.record(entry);
      runMeta.textContent=metadata(saved.run);feedback(saved);
      resume.hidden=freshResume.hidden=!(saved.run.canContinue && !saved.run.continuedBy);return saved;
    }catch(error){if(stamp===epoch){fail(error);if(error.runId){selectedRun=await engine.repository.get(error.runId);if(selectedRun){runMeta.textContent=metadata(selectedRun.run);feedback(selectedRun);resume.hidden=freshResume.hidden=!(selectedRun.run.canContinue && !selectedRun.run.continuedBy);}}}throw error;}
    finally{if(controller===abort){controller=null;stop.hidden=true;for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=false;modelPicker.setDisabled(false);history.inert=false;updatePreview();if(stamp===epoch)await savedRuns({select:selectedRun?.run.id});}}
  }
  async function run(extra={},startOptions={}) {
    await ready;if(!usable(startOptions.providerInfo??modelPicker.info))throw Error('Choose a signed-in, accepted provider with tool isolation, or open Seatline settings.');
    if(!doc || !scope)throw Error('Open a document and choose its scope first.');if(extra.budget===undefined && !budget.reportValidity())throw Error('Choose a record budget from 1 to 200.');
    const config=configuration(extra);const measured=engine.preview(config);if(!measured.fits)throw Error(measured.hint);
    if(config.operation==='situate' && !modelPicker.info?.capabilities?.webSearch)throw Error('This provider does not advertise web search. Choose a search-capable provider for Situate.');
    return work(opts=>engine.start(config,{...opts,...startOptions}),config.lens,doc,{customLens:config.customLens});
  }
  async function continueRun(mode='auto') {
    if(!selectedRun)throw Error('Choose a partial run.');const id=selectedRun.run.id,preview=await engine.previewContinuation(id,{mode});
    if(!preview.fits)throw Error(preview.hint);const source=await store.getDocument(doc.id,selectedRun.run.extractionVersion);
    return work(opts=>engine.continue(id,{...opts,mode}),selectedRun.run.lens,source);
  }
  async function retryPassage() {
    await ready;if(controller)throw Error('Stop the current run before starting another.');
    const prior=selectedRun?.run,stamp=epoch;
    if(!prior?.config?.action || !['invalid','failed','interrupted'].includes(prior.status))throw Error('Choose a failed passage run first.');
    if(!usable(modelPicker.info))throw Error('Choose a signed-in, accepted provider first.');
    const target=modelPicker.target,tier=outputTier(modelPicker.tier),persistent=modelPicker.info.capabilities?.sessions===true;
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
    for(const saved of pair){const source=await store.getDocument(saved.run.docId,saved.run.extractionVersion);if(stamp!==epoch)return;const column=element('section');column.append(element('h4',metadata(saved.run)));columns.append(column);const v=createAnalysisView(column,{lens:saved.run.lens,doc:source,onReference:n=>reference(n,source),onInspect:e=>inspect(e,source)});compareViews.push(v);for(const e of saved.records)v.record(e);}
  }
  async function library() {
    const rows=await store.listDocuments();documents.replaceChildren();if(!rows.length)documents.append(element('p','Your saved documents will appear here.'));
    for(const item of rows){const card=element('article');card.append(element('h4',item.title),element('p',[item.kind.toUpperCase(),item.updatedAt?new Date(item.updatedAt).toLocaleDateString():null].filter(Boolean).join(' · ')),button('Open saved document',()=>onOpenDocument(item.id)));documents.append(card);}
  }
  openArea('analyze');history.hidden=true;updatePreview();
  toolkit=await createToolkit({analyze:areas.analyze.area,ask:areas.ask.area,root,store,engine,client,storage,api:{state:()=>({doc,scope}),configuration,active:()=>!!controller,cancel:()=>controller?.abort(),work,fail,reference,showSaved:loadRun,openArea,selected:()=>selectedRun,view:()=>view,
    customChanged:definitions=>{const chosen=lens.value;customMap.clear();for(const d of definitions)customMap.set('custom:'+d.id,d);options(lens,[...builtins,...definitions.map(d=>['custom:'+d.id,d.name])]);if([...lens.options].some(o=>o.value===chosen))lens.value=chosen;updatePreview();},
    chooseLens:value=>{lens.value=value;lens.dispatchEvent(new lens.ownerDocument.defaultView.Event('change'));},
    studio:async({chatId,area,chatContext,pairId})=>{if(!doc)throw Error('Open a document first.');if(!globalThis.chrome?.tabs)throw Error('Studio opens in the installed extension.');const id=crypto.randomUUID(),shown=area==='ask'?null:selectedRun?.run,source=area==='ask'&&chatContext?chatContext.doc:shown?await store.getDocument(shown.docId,shown.extractionVersion):doc,chosen=area==='ask'&&chatContext?chatContext.scope:shown?restoreScope(source,shown.scope):scope;await chrome.storage.session.set({['sharh:studio:'+id]:{docId:source.id,version:source.version,runId:shown?.id,scope:chosen?scopeDescriptor(chosen):null,compareId:!comparison.hidden?compareWith.value:null,chatId,area,pairId}});await chrome.tabs.create({url:chrome.runtime.getURL('ui/reader.html?studio='+id)});}}});
  return {ready,run,async setDocument(value){epoch++;loading++;controller?.abort();doc=value;scope=value?buildScope(value):null;selectedRun=null;title.textContent=value?.title??'Choose a document';inspection.hidden=true;comparison.hidden=true;diagnostics.hidden=true;for(const v of compareViews)v.dispose();compareViews=[];view?.dispose();view=null;results.replaceChildren();runMeta.textContent='';resume.hidden=freshResume.hidden=retry.hidden=true;updatePreview();if(value)await savedRuns({display:true});else history.hidden=true;await toolkit.setDocument();},
    setScope(value){scope=value;toolkit.scopeChanged(value);updatePreview();},measureScope(value,chosen){try{return engine.preview({...configuration(),doc:value,scope:chosen});}catch{return null;}},
    async passage(action,selection,{intentId,onAccepted}={}){
      if(controller)throw Error('Stop the current run before starting another.');
      if(action==='Ask about this'){await ready;return toolkit.askSelection({...configuration(),scope:buildScope(doc,{kind:'selection',spans:selection.spans})},{intentId,onAccepted});}
      if(!Object.hasOwn(PASSAGE_ACTIONS,action))throw Error('Unknown passage action.');await ready;
      const passageScope=buildScope(doc,{kind:'selection',spans:selection.spans}),quick=await modelPicker.forTier('quick'),lensName=action==='Logic'?'logic':'passage';
      return run({scope:passageScope,target:quick.target,tier:'quick',persistent:quick.info.capabilities?.sessions===true,budget:24,lens:lensName,action,focus:''},
        {providerInfo:quick.info,allowSavedExtraction:true,onBegin:async run=>{if(intentId)await engine.repository.write(run.id,{passageIntentId:intentId});await onAccepted?.(run);}});
    },
    openSaved:loadRun,openChat:toolkit.openChat,
    visibleParagraphs(numbers,source){for(const current of [view,...compareViews].filter(Boolean))current.setVisibleParagraphs(source?.docId===current.source.docId && source?.version===current.source.version?numbers:[]);toolkit.visibleParagraphs(numbers,source);},
    async restoreStudio(intent){if(intent.scope?.docId===doc?.id && intent.scope.version===doc?.version){scope=restoreScope(doc,intent.scope);updatePreview();}if(intent.runId)await loadRun(intent.runId);if(intent.compareId){versions.value=intent.runId;compareWith.value=intent.compareId;await compareRuns();}if(intent.chatId)await toolkit.openChat(intent.chatId);if(intent.pairId)await toolkit.openPair(intent.pairId);openArea(intent.area??'analyze');},
    get document(){return doc;},get selectionScope(){return scope;},get target(){return modelPicker.target;},get active(){return !!controller;},get view(){return view;},
    dispose(){epoch++;controller?.abort();toolkit.dispose();view?.dispose();for(const v of compareViews)v.dispose();modelPicker.dispose();appearance.dispose();root.remove();}};
}
