import {MODEL_ID} from '../paths/limits.mjs';
export const TIERS = Object.freeze({quick:'Quick',analysis:'Analysis',book:'Book pass',synthesis:'Synthesis'});
export const DEFAULTS = Object.freeze({
  quick:{path:'seatline',provider:'claude',model:'haiku',effort:'low'},
  analysis:{path:'seatline',provider:'claude',model:'opus',effort:'high'},
  book:{path:'seatline',provider:'claude',model:'sonnet',effort:'medium'},
  synthesis:{path:'seatline',provider:'claude',model:'opus',effort:'high'}
});
export const outputTier = tier => tier==='book'?'analysis':tier;
export function validateTarget(target,info) {
  if(!info || target.path!==info.path || target.provider!==info.provider)throw Error('Choose an available model provider.');
  if(target.model && !MODEL_ID.test(target.model))throw Error('Use a model ID of 1–128 letters, numbers or . _ : / @ - characters.');
  if(target.effort && !info.capabilities?.effort?.includes(target.effort))throw Error('This provider does not accept that effort.');
  if(target.serviceTier && !info.capabilities?.serviceTier?.includes(target.serviceTier))throw Error('This provider does not accept that speed.');
  return {...target,model:target.model || null};
}
export function targetFor(info,saved={}) {
  return {path:info.path,provider:info.provider,model:saved.model || null,
    ...(info.capabilities?.effort?.includes(saved.effort)?{effort:saved.effort}:{}),
    ...(info.capabilities?.serviceTier?.includes(saved.serviceTier)?{serviceTier:saved.serviceTier}:{})};
}
export function usable(info) {return !!(info?.available && info.signedIn && info.accepted && info.capabilities?.toolIsolation);}
export function providerBadges(info) {
  const c=info.capabilities??{};
  return [info.available?'Installed':'Unavailable',info.signedIn?`Signed in · ${info.signIn??'unknown'}`:'Sign-in needed',
    info.accepted?'Policy accepted':'Policy not accepted',...['streaming','sessions','webSearch','toolIsolation'].map((k,i)=>`${c[k]?'':'No '}${['streaming','sessions','web search','tool isolation'][i]}`)];
}
// How much a lens reports. The numbers are record budgets; the reader only chooses a word.
export const DETAIL = Object.freeze({brief:12,standard:24,thorough:60});
export const DETAIL_LABELS = Object.freeze({brief:'Brief',standard:'Standard',thorough:'Thorough'});
export const AUTO_READ = Object.freeze({never:'Ask me first',allowed:'On sites I have allowed'});
// Jobs other than Analysis can follow the default model. Analysis is the default.
export const FOLLOWING = Object.freeze(['quick','book','synthesis']);
export const PARTNER_DEFAULT = Object.freeze({path:'seatline',provider:'codex',model:null});
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
export class ReadingPreferences {
  constructor(storage) {this.storage=storage;this.value={theme:'system',language:'en',detail:'standard',autoRead:'never',follow:[],partner:{...PARTNER_DEFAULT},tiers:structuredClone(DEFAULTS)};}
  async load() {
    const saved=(await this.storage.get('sharhReading'))?.sharhReading??{};
    const tiers=Object.fromEntries(Object.keys(TIERS).map(k=>[k,{...DEFAULTS[k],...(saved.tiers?.[k]??{})}]));
    const follow=Array.isArray(saved.follow)?FOLLOWING.filter(k=>saved.follow.includes(k)):[];
    for(const k of follow)tiers[k]={...tiers.analysis};
    const partner=saved.partner && typeof saved.partner==='object' && /^[a-z][a-z0-9-]{0,31}$/.test(saved.partner.path) && typeof saved.partner.provider==='string' && saved.partner.provider.length<=64?{path:saved.partner.path,provider:saved.partner.provider,model:saved.partner.model||null}:{...PARTNER_DEFAULT};
    this.value={theme:['system','ink','parchment'].includes(saved.theme)?saved.theme:'system',
      language:typeof saved.language==='string' && LANGUAGE.test(saved.language)?saved.language:'en',
      detail:Object.hasOwn(DETAIL,saved.detail)?saved.detail:'standard',
      autoRead:Object.hasOwn(AUTO_READ,saved.autoRead)?saved.autoRead:'never',
      follow,partner,tiers};
    return this.value;
  }
  async save(patch) {
    await this.load();
    this.value={...this.value,...patch,tiers:{...this.value.tiers,...patch.tiers}};
    await this.storage.set({sharhReading:this.value});return this.value;
  }
}
