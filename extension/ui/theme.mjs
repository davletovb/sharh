import {ReadingPreferences} from '../../src/ui/preferences.mjs';
import {element,field,options} from './dom.mjs';
export async function bindAppearance(container,{storage=chrome.storage.local,changes=chrome.storage.onChanged,onChange=()=>{}}={}) {
  const preferences=new ReadingPreferences(storage),value=await preferences.load(),theme=element('select'),language=element('input');
  options(theme,[['system','System'],['ink','Ink and gold'],['parchment','Parchment']]);theme.value=value.theme;
  language.value=value.language;language.maxLength=35;language.placeholder='en, uz, ru, ar';language.pattern='[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}';
  container?.append(field('Theme',theme),field('Output language',language));
  const apply=v=>{document.documentElement.dataset.theme=v.theme;theme.value=v.theme;language.value=v.language;onChange(v);};apply(value);
  theme.addEventListener('change',()=>preferences.save({theme:theme.value}).then(apply));
  language.addEventListener('change',()=>{if(language.reportValidity() && language.value)preferences.save({language:language.value}).then(apply);});
  const changed=(changes,area)=>{if(area==='local' && changes.sharhReading?.newValue)preferences.load().then(apply);};changes?.addListener(changed);
  return {get value(){return preferences.value;},dispose:()=>changes?.removeListener(changed)};
}
