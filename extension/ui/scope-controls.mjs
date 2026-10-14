import {element,field,button} from './dom.mjs';
export function scopeControls() {
  const root=element('section');root.id='scope-picker';root.hidden=true;const heading=element('h2','Scope');heading.id='scope-heading';root.setAttribute('aria-labelledby',heading.id);root.append(heading);
  const make=(tag,id)=>{const node=element(tag);node.id=id;return node;};
  root.append(field('Read',make('select','scope-kind')));
  const section=field('Section',make('select','scope-section'));section.id='scope-section-label';section.hidden=true;root.append(section);
  const chapter=field('Chapters',make('select','chapter-level'));chapter.id='chapter-level-label';root.append(chapter);
  const pages=make('div','scope-pages');pages.hidden=true;
  for(const [id,text]of [['scope-first','First PDF page'],['scope-last','Last PDF page']]){const input=make('input',id);input.type='number';input.min=1;input.value=1;pages.append(field(text,input));}root.append(pages);
  const refresh=button('Refresh selection',()=>{});refresh.id='scope-refresh';const size=make('p','scope-size');size.setAttribute('role','status');root.append(refresh,size,make('p','scope-help'),element('p','Choosing a scope sends no document text to a model.','note'));return root;
}
