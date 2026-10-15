import {ReadingPreferences,TIERS,DEFAULTS,targetFor,validateTarget,providerBadges,usable} from '../../src/ui/preferences.mjs';
import {element,field,options,button} from './dom.mjs';
export async function createModelPicker(container,{client,storage=chrome.storage.local,onChange=()=>{},tierControls=true,initialTarget=null,discovery=null}) {
  const preferences=new ReadingPreferences(storage);await preferences.load();
  const tier=element('select'),target=element('select'),model=element('input'),effort=element('select'),speed=element('select'),status=element('p','','note');
  const modelField=field('Model ID (empty uses provider default)',model),effortField=field('Effort',effort),speedField=field('Speed',speed);
  model.maxLength=128;options(tier,Object.entries(TIERS));tier.value='analysis';target.setAttribute('aria-describedby',status.id='model-status-'+crypto.randomUUID());
  if(tierControls)container.append(field('Task tier',tier));container.append(field('Model target',target),modelField,effortField,speedField);
  const save=button('Save as tier default',async()=>{const value=getTarget();await preferences.save({tiers:{[tier.value]:value}});status.textContent=`Default saved for ${TIERS[tier.value]}.`;});
  const reset=button('Use tier default',()=>loadDefault());const refresh=button('Refresh providers',()=>discover(true));if(tierControls)container.append(save,reset);container.append(refresh,status);
  let providers=[],choices=[],selected=null,revision=0;
  function info(){return selected;}
  function getTarget() {return validateTarget({path:selected?.path,provider:selected?.provider,model:modelField.hidden?choices[Number(target.value)]?.model:model.value.trim(),
    effort:effortField.hidden || !effort.value?null:effort.value,serviceTier:speedField.hidden || !speed.value?null:speed.value},selected);}
  function changed(){try{onChange(getTarget(),info(),tier.value);}catch(error){status.textContent=error.message;onChange(null,info(),tier.value);}}
  function fill(desired={}) {
    selected=choices[Number(target.value)]?.info??null;
    if(!selected){modelField.hidden=effortField.hidden=speedField.hidden=true;status.textContent='No providers discovered. Open Seatline settings to connect.';changed();return;}
    modelField.hidden=!!selected.models?.length;model.value=desired.model??'';
    options(effort,[['','Provider default'],...(selected.capabilities?.effort??[]).map(v=>[v,v])]);effortField.hidden=!selected.capabilities?.effort?.length;effort.value=selected.capabilities?.effort?.includes(desired.effort)?desired.effort:'';
    options(speed,[['','Provider default'],...(selected.capabilities?.serviceTier??[]).map(v=>[v,v])]);speedField.hidden=!selected.capabilities?.serviceTier?.length;speed.value=selected.capabilities?.serviceTier?.includes(desired.serviceTier)?desired.serviceTier:'';
    status.textContent=`${selected.label??selected.provider}: ${providerBadges(selected).join(' · ')}${selected.error?.hint?' · '+selected.error.hint:''}`;changed();
  }
  function choose(desired) {
    let index=choices.findIndex(c=>c.info.path===desired.path && c.info.provider===desired.provider && (c.model??null)===(desired.model??null));
    if(index<0)index=choices.findIndex(c=>c.info.path===desired.path && c.info.provider===desired.provider);
    target.value=String(index<0?0:index);fill(desired);
  }
  async function loadDefault(){await preferences.load();choose(preferences.value.tiers[tier.value]??DEFAULTS[tier.value]);}
  async function discover(fresh=false) {
    const ticket=++revision;refresh.disabled=true;status.textContent='Checking providers…';
    let desired;try{desired=getTarget();}catch{}
    try {
      const result=await (!fresh&&discovery?discovery:client.call('discover',{fresh}));if(ticket!==revision)return;providers=result;choices=[];target.replaceChildren();
      for(const p of providers) {
        const group=element('optgroup');group.label=`${p.path==='seatline'?'Seatline':p.path} / ${p.label??p.provider}`;
        for(const m of [{id:null,label:'Provider default'},...(p.models??[])]) {
          const o=element('option',m.label+(usable(p)?'':' · unavailable'));o.value=String(choices.length);choices.push({info:p,model:m.id});group.append(o);
        }
        target.append(group);
      }
      choose(desired??initialTarget??preferences.value.tiers[tier.value]);
    }catch(error){status.textContent=error.hint??error.message;onChange(null,null,tier.value);}
    finally{if(ticket===revision)refresh.disabled=false;}
  }
  tier.addEventListener('change',()=>{loadDefault();});
  target.addEventListener('change',()=>{fill();const t=getTarget();client.call('prepare',{trigger:'model-picker',target:t}).catch(()=>{});});
  for(const control of [model,effort,speed])control.addEventListener('change',changed);
  const ready=discover();
  async function forTier(value) {
    await ready;await preferences.load();const desired=preferences.value.tiers[value];if(!desired)throw Error('Unknown task tier.');
    const choice=choices.find(c=>c.info.path===desired.path && c.info.provider===desired.provider && (c.model??null)===(desired.model??null))
      ??choices.find(c=>c.info.path===desired.path && c.info.provider===desired.provider)??choices[0];
    if(!choice)throw Error('Choose an available model provider.');
    const sameProvider=choice.info.path===desired.path && choice.info.provider===desired.provider;
    const saved=sameProvider?{...desired,model:choice.info.models?.length?choice.model:desired.model}:{};
    return {target:validateTarget(targetFor(choice.info,saved),choice.info),info:choice.info};
  }
  return {ready,forTier,get providers(){return providers;},get target(){return getTarget();},get info(){return info();},get tier(){return tier.value;},setTarget(value){choose(value);},setTier(value){if(Object.hasOwn(TIERS,value)){tier.value=value;return loadDefault();}},discover,
    setDisabled(value){for(const control of container.querySelectorAll('input,select,button'))control.disabled=value;},dispose(){revision++;}};
}
