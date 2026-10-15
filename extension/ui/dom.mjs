let serial=0;const namespace=crypto.randomUUID();
export const uid = prefix => `${prefix}-${namespace}-${++serial}`;
export function element(tag,text='',className='',doc=document) {
  const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;
}
export function button(text,action,className='') {
  const node=element('button',text,className);node.type='button';node.addEventListener('click',event=>{Promise.resolve().then(()=>action(event)).catch(error=>{node.dispatchEvent(new CustomEvent('sharh:error',{detail:error,bubbles:true}));});});return node;
}
export function field(text,control) {const label=element('label'),caption=element('span',text);caption.id=uid('label');control.id ||= uid('field');label.htmlFor=control.id;control.setAttribute('aria-labelledby',caption.id);label.append(caption,control);return label;}
export function options(control,items) {control.replaceChildren(...items.map(([value,text])=>{const o=element('option',text);o.value=value;return o;}));}
