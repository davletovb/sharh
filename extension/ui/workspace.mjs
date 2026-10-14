import {buildScope} from '../../src/documents/scopes.mjs';
import {outputTier,usable} from '../../src/ui/preferences.mjs';
import {runState} from '../../src/paths/diagnostics.mjs';
import {createModelPicker} from './model-picker.mjs';
import {bindAppearance} from './theme.mjs';
import {createAnalysisView,referenceButtons} from './views.mjs';
import {element,button,field,options,uid} from './dom.mjs';
export const PASSAGE_ACTIONS=Object.freeze({Explain:'Explain the selected passage in plain language, using its context. Gloss key terms.',Translate:'Translate the selected passage faithfully into the output language. Keep original terms beside their translations and explain difficult terms.',Logic:'Explain what the author is doing in the selected passage and how it relates to the surrounding argument. Label stated and inferred claims.',Define:'Define the selected term as used in this text, distinguish its general meaning, and cite the paragraph that introduces it.'});
export async function createWorkspace(container,{store,engine,client,storage=chrome.storage.local,changes=chrome.storage.onChanged,onReference=()=>{},onOpenDocument=()=>{},onControlsChanged=()=>{}}) {
  let doc=null,scope=null,selectedRun=null,view=null,epoch=0,controller=null,runId=null,preview=null,modelPicker,appearance,loading=0,viewDoc=null;
  const root=element('section','','workspace'),heading=element('header'),title=element('h2','Choose a document','workspace-title'),scopeLabel=element('p','No scope selected.','scope-label'),size=element('p','','scope-estimate');
  heading.append(title,scopeLabel,size);const appearanceHost=element('div','','appearance-controls'),modelHost=element('details','','model-picker'),modelSummary=element('summary','Model and task tier'),modelBody=element('div','','control-grid');modelHost.append(modelSummary,modelBody);
  root.append(heading,appearanceHost,modelHost);container.append(root);
  const nav=element('nav','','workspace-nav');nav.setAttribute('aria-label','Reading workspace');const areas={};
  for(const label of ['Analyze','Ask','Library']) {
    const key=label.toLowerCase(),area=element('div','','workspace-area'),tab=button(label,()=>openArea(key));tab.id=uid('area-button');area.id=uid('area');tab.setAttribute('aria-controls',area.id);area.setAttribute('aria-labelledby',tab.id);area.setAttribute('role','region');nav.append(tab);areas[key]={area,tab};
  }
  root.append(nav,...Object.values(areas).map(v=>v.area));
  function openArea(key){for(const [name,v]of Object.entries(areas)){v.area.hidden=name!==key;v.tab.setAttribute('aria-pressed',String(name===key));}if(key==='library')library().catch(fail);}
  const controls=element('div','','analysis-controls'),lens=element('select'),budget=element('input'),focus=element('textarea');
  options(lens,[['summary','Summary'],['structure','Structure'],['logic','Logic'],['thinking','Thinking']]);budget.type='number';budget.min=1;budget.max=200;budget.value=24;focus.maxLength=4000;focus.rows=2;
  const analyze=button('Analyze',()=>run()),stop=button('Stop',()=>controller?.abort()),resume=button('Continue',()=>continueRun()),freshResume=button('Continue with fresh context',()=>continueRun('new'));
  analyze.classList.add('primary');stop.hidden=resume.hidden=freshResume.hidden=true;
  controls.append(field('Lens',lens),field('Record budget',budget),field('Focus (optional)',focus),analyze,stop,resume,freshResume);
  const status=element('p','Choose a scope and model.','run-state');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const history=element('div','','run-history'),versions=element('select'),compareWith=element('select'),compare=button('Compare versions',()=>compareRuns()),historyLabel=field('Saved runs',versions),compareLabel=field('Compare with',compareWith);
  history.append(historyLabel,compareLabel,compare);
  const runMeta=element('p','','run-metadata'),results=element('div','','analysis-results'),inspection=element('aside','','finding-inspector');inspection.setAttribute('aria-label','Finding inspection');inspection.hidden=true;
  const comparison=element('section','','version-comparison');comparison.hidden=true;
  areas.analyze.area.append(controls,status,history,runMeta,results,inspection,comparison);
  areas.ask.area.append(element('h3','Ask about your text'),element('p','Grounded conversation is coming soon. You can already select a passage and choose Explain, Translate, Logic or Define.'),button('Analyze this scope',()=>openArea('analyze')));
  const documents=element('div','','library-documents');areas.library.area.append(element('h3','Saved documents'),element('p','Documents and their reading history stay on this computer. Open a document to see its saved runs.'),documents);
  root.addEventListener('sharh:error',event=>{event.stopPropagation();fail(event.detail);});
  function fail(error){status.textContent=error.hint??error.message??String(error);}
  function targetName(target){return `${target?.provider??'No provider'} · ${target?.model || 'provider default'}${target?.effort?' · '+target.effort:''}${target?.serviceTier?' · '+target.serviceTier:''}`;}
  function configuration(extra={}) {
    return {doc,scope,target:modelPicker.target,lens:lens.value,language:appearance.value.language,budget:Number(budget.value),focus:focus.value,
      tier:outputTier(modelPicker.tier),persistent:modelPicker.info?.capabilities?.sessions===true,...extra};
  }
  function updatePreview() {
    preview=null;scopeLabel.textContent=scope?scope.label:'No scope selected.';
    try {
      if(doc && scope && modelPicker && appearance){preview=engine.preview(configuration());size.textContent=`≈${preview.estimatedTokens.toLocaleString()} tokens · ${preview.requestBytes.toLocaleString()} / ${preview.maxRequestBytes.toLocaleString()} bytes · ${targetName(modelPicker.target)}`;if(!preview.fits)status.textContent=preview.hint;}
      else size.textContent='';
    }catch(error){fail(error);size.textContent='';}
    analyze.disabled=!!controller || !preview?.fits || !usable(modelPicker?.info);
  }
  function changed(){updatePreview();onControlsChanged();}
  appearance=await bindAppearance(appearanceHost,{storage,changes,onChange:()=>{if(appearance)changed();}});
  modelPicker=await createModelPicker(modelBody,{client,storage,onChange:()=>{if(modelPicker)changed();}});
  const ready=modelPicker.ready.then(changed);
  for(const control of [lens,budget,focus])control.addEventListener('change',changed);
  function reference(n,source=viewDoc??doc){const block=source?.blocks.find(b=>b.n===n);if(!block){fail(Error('This paragraph is not in the saved extraction.'));return;}Promise.resolve(onReference(block,source)).catch(fail);}
  function inspect(entry,source=viewDoc??doc) {
    const r=entry.record;inspection.replaceChildren(element('h3',r.title??r.term??'Inspect finding'),element('p',r.text??r.gist??r.gloss??''));inspection.hidden=false;
    if(r.basis)inspection.append(element('p',r.basis==='inferred'?'Inferred · reconstructed by the model':'Stated · presented as stated in the text','basis '+r.basis));
    for(const n of (r.refs??[]).slice(0,4)){const block=source?.blocks.find(b=>b.n===n);if(block){const quote=element('blockquote',block.text);quote.dir='auto';inspection.append(element('strong',`¶${n}${block.pageLabel?' · p. '+block.pageLabel:''}`),quote);}}
    inspection.append(referenceButtons(source,r,n=>reference(n,source)));
  }
  function newView(lensName,source) {view?.dispose();viewDoc=source;results.replaceChildren();view=createAnalysisView(results,{lens:lensName,doc:source,onReference:n=>reference(n,source),onInspect:entry=>inspect(entry,source)});return view;}
  function metadata(run){return `${run.lens} · v${run.version} · ${run.status}${run.stale?' · older extraction':''} · ${targetName(run.target)} · ${run.scope.label} · ${new Date(run.createdAt).toLocaleString()}`;}
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
    selectedRun=saved;newView(saved.run.lens,source);for(const entry of saved.records)view.record(entry);runMeta.textContent=metadata(saved.run);
    resume.hidden=freshResume.hidden=!(saved.run.canContinue!==false && saved.run.metrics?.truncated && !saved.run.continuedBy && saved.run.status!=='running');
    status.textContent=`Loaded ${saved.records.length} saved findings. No new analysis requested.`;inspection.hidden=true;comparison.hidden=true;
  }
  versions.addEventListener('change',()=>loadRun(versions.value).catch(fail));
  async function work(operation,lensName,source) {
    if(controller)throw Error('Stop the current run before starting another.');const stamp=epoch,abort=new AbortController();controller=abort;runId=null;selectedRun=null;
    const sink=newView(lensName,source);openArea('analyze');inspection.hidden=true;comparison.hidden=true;resume.hidden=freshResume.hidden=true;stop.hidden=false;runMeta.textContent='';status.textContent='Connecting…';
    for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=true;modelPicker.setDisabled(true);history.inert=true;analyze.disabled=true;
    try {
      const saved=await operation({signal:abort.signal,onEvent:event=> {
        if(stamp!==epoch)return;if(event.type==='run' && event.status==='running')runId=event.runId;
        if(event.type==='record')sink.record(event.entry);if(event.type==='reset')sink.reset();
        const state=runState(event);if(state)status.textContent=state;
        if(event.type==='repairing')status.textContent='Checking the partial response…';if(event.type==='session_reset')status.textContent='Session expired. Sending this scope again.';
      }});
      if(stamp!==epoch)return saved;await sink.settled();selectedRun=saved;sink.reset();for(const entry of saved.records)sink.record(entry);
      runMeta.textContent=metadata(saved.run);status.textContent=`${saved.run.status==='completed'?'Completed':'Partial result saved'} · ${saved.records.length} findings.`;
      resume.hidden=freshResume.hidden=!(saved.run.canContinue && !saved.run.continuedBy);return saved;
    }catch(error){if(stamp===epoch){fail(error);if(error.runId){selectedRun=await engine.repository.get(error.runId);if(selectedRun){runMeta.textContent=metadata(selectedRun.run);resume.hidden=freshResume.hidden=!(selectedRun.run.canContinue && !selectedRun.run.continuedBy);}}}throw error;}
    finally{if(controller===abort){controller=null;stop.hidden=true;for(const control of controls.querySelectorAll('input,select,textarea'))control.disabled=false;modelPicker.setDisabled(false);history.inert=false;updatePreview();if(stamp===epoch)await savedRuns({select:selectedRun?.run.id});}}
  }
  async function run(extra={},startOptions={}) {
    await ready;if(!usable(modelPicker.info))throw Error('Choose a signed-in, accepted provider with tool isolation, or open Seatline settings.');
    if(!doc || !scope)throw Error('Open a document and choose its scope first.');if(!budget.reportValidity())return;
    const config=configuration(extra);const measured=engine.preview(config);if(!measured.fits)throw Error(measured.hint);
    return work(opts=>engine.start(config,{...opts,...startOptions}),config.lens,doc);
  }
  async function continueRun(mode='auto') {
    if(!selectedRun)throw Error('Choose a partial run.');const id=selectedRun.run.id,preview=await engine.previewContinuation(id,{mode});
    if(!preview.fits)throw Error(preview.hint);const source=await store.getDocument(doc.id,selectedRun.run.extractionVersion);
    return work(opts=>engine.continue(id,{...opts,mode}),selectedRun.run.lens,source);
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
    for(const item of rows){const card=element('article');card.append(element('h4',item.title),element('p',`${item.kind.toUpperCase()} · ${item.updatedAt?new Date(item.updatedAt).toLocaleDateString():''}`),button('Open saved document',()=>onOpenDocument(item.id)));documents.append(card);}
  }
  openArea('analyze');history.hidden=true;updatePreview();
  return {ready,run,async setDocument(value){epoch++;loading++;controller?.abort();doc=value;scope=value?buildScope(value):null;selectedRun=null;title.textContent=value?.title??'Choose a document';inspection.hidden=true;comparison.hidden=true;for(const v of compareViews)v.dispose();compareViews=[];view?.dispose();view=null;results.replaceChildren();runMeta.textContent='';resume.hidden=freshResume.hidden=true;updatePreview();if(value)await savedRuns({display:true});else history.hidden=true;},
    setScope(value){scope=value;updatePreview();},measureScope(value,chosen){try{return engine.preview({...configuration(),doc:value,scope:chosen});}catch{return null;}},
    async passage(action,selection,{intentId,onAccepted}={}){if(!Object.hasOwn(PASSAGE_ACTIONS,action))throw Error('Unknown passage action.');await ready;scope=buildScope(doc,{kind:'selection',spans:selection.spans});await modelPicker.setTier('quick');changed();const lensName=action==='Logic'?'logic':'passage';return run({scope,lens:lensName,focus:`Passage action: ${action}. ${PASSAGE_ACTIONS[action]}`},{onBegin:async run=>{if(intentId)await engine.repository.write(run.id,{passageIntentId:intentId});await onAccepted?.(run);}});},
    openSaved:loadRun,
    get document(){return doc;},get selectionScope(){return scope;},get target(){return modelPicker.target;},get active(){return !!controller;},get view(){return view;},
    dispose(){epoch++;controller?.abort();view?.dispose();for(const v of compareViews)v.dispose();modelPicker.dispose();appearance.dispose();root.remove();}};
}
