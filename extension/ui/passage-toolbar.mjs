// Shared selection interaction for source pages and the PDF/local-text reader.
import {icon} from './icons.mjs';
// The toolbar lives in a closed shadow root on other people's pages, so it carries its own tokens.
const LIGHT='--bg:#fffbf2;--text:#272a2b;--muted:#575d61;--line:#d9ccae;--gold:#7a5710;--on-gold:#fffaf0;--chip:#ece2cb;--focus:#0b5cad;--shadow:#2a24124d;';
const DARK='--bg:#151f2a;--text:#f1e8d6;--muted:#a9b6c2;--line:#2b3b4b;--gold:#e7c27a;--on-gold:#1a1405;--chip:#1d2a38;--focus:#a8dcff;--shadow:#000a;';
export const TOOLBAR_CSS=`:host{all:initial;position:fixed;z-index:2147483647;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;${LIGHT}}
:host([data-theme=ink]){${DARK}}
@media(prefers-color-scheme:dark){:host(:not([data-theme=parchment]):not([data-theme=ink])){${DARK}}}
[hidden]{display:none!important}
.passage-toolbar,.passage-toast{display:flex;flex-wrap:wrap;align-items:center;gap:2px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:14px;padding:5px 5px 5px 10px;box-shadow:0 10px 30px var(--shadow);max-width:min(400px,calc(100vw - 24px))}
.passage-toast{padding:9px 14px;font-weight:550}
.passage-brand{color:var(--gold);width:18px;height:18px;flex:none;margin-inline-end:4px}
button{font:inherit;font-size:13px;font-weight:600;color:var(--text);background:transparent;border:1px solid transparent;border-radius:9px;padding:5px 10px;margin:0;cursor:pointer;min-height:34px}
button:hover{background:var(--chip)}
button.primary{background:var(--gold);color:var(--on-gold)}
button.primary:hover{filter:brightness(1.08)}
button.close{margin-inline-start:auto;padding:5px;min-width:34px;color:var(--muted)}
button.close svg{width:16px;height:16px;display:block;margin:auto}
button:focus-visible{outline:3px solid var(--focus);outline-offset:1px}
.passage-context{flex-basis:100%;margin:0;padding:0 6px 3px 26px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}`;
export function installSelectionToolbar({document,selection,resolveSelection,onAction,enabled=async()=>true,onPrepare=()=>{},shadow=false,theme='system'}) {
  let host,bar,toast,toastTimer,saved,revision=0,closed=false,allowed=false,shown=null,dismissed=null;
  function hide(){bar?.setAttribute('hidden','');}
  function capture() {
    const selected=document.defaultView.getSelection();if(!selected?.rangeCount || selected.isCollapsed || !selected.toString().trim())return null;
    const range=selected.getRangeAt(0),element=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    if(element?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-sharh-toolbar]'))return null;
    return {range:range.cloneRange(),text:range.toString()};
  }
  function same(a,b){return !!(a && b && a.text===b.text && a.range.startContainer===b.range.startContainer && a.range.startOffset===b.range.startOffset && a.range.endContainer===b.range.endContainer && a.range.endOffset===b.range.endOffset);}
  function dismiss(){revision++;dismissed=capture();shown=null;hide();}
  function create() {
    if(bar)return;host=document.createElement('div');host.dataset.sharhToolbar='true';
    const root=shadow?host.attachShadow({mode:'closed'}):host;
    if(shadow){host.dataset.theme=theme;const style=document.createElement('style');style.textContent=TOOLBAR_CSS;root.append(style);}
    bar=document.createElement('div');bar.className='passage-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Passage actions');
    const hint=document.createElement('p');hint.className='passage-context';
    const brand=icon('star',{size:18,className:'passage-brand',doc:document});bar.append(brand);
    toast=document.createElement('div');toast.className='passage-toast';toast.setAttribute('role','status');toast.hidden=true;
    for(const action of ['Explain','Translate','Argument','Define','Ask about this']) {
      const b=document.createElement('button');b.type='button';b.textContent=action;if(action==='Explain')b.className='primary';
      b.addEventListener('pointerdown',e=>e.preventDefault());
      b.addEventListener('click',()=>{const chosen=saved,snapshot=shown;dismiss();if(chosen){toast.textContent='Sent to Sharh. The answer opens in the side panel.';toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},2200);}if(chosen)Promise.resolve().then(async()=>{
        if(snapshot?.range.toString()!==snapshot?.text)throw Error('The selected text changed. Select the passage again.');
        const value=resolveSelection?await resolveSelection(chosen):chosen;
        if(snapshot?.range.toString()!==snapshot?.text)throw Error('The selected text changed. Select the passage again.');
        return onAction(action,value);
      }).catch(error=>{toast.hidden=true;hint.textContent=error.message;shown=snapshot;bar.hidden=false;});});bar.append(b);
    }
    const close=document.createElement('button');close.type='button';close.className='close';close.setAttribute('aria-label','Dismiss');close.title='Dismiss';close.append(icon('close',{size:16,doc:document}));close.addEventListener('pointerdown',e=>e.preventDefault());close.addEventListener('click',()=>dismiss());bar.append(close,hint);
    bar.addEventListener('keydown',e=>{const buttons=[...bar.querySelectorAll('button')],at=buttons.indexOf(root.activeElement??document.activeElement);if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();}if(e.key==='Escape')dismiss();});
    root.append(bar,toast);document.body.append(host);hide();
  }
  async function update(event) {
    if(closed || event?.composedPath().includes(host))return;
    if(event?.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')){revision++;shown=null;hide();return;}
    if(event?.type==='keyup' && !(event.shiftKey && /^(Arrow|Home$|End$|Page)/.test(event.key)) && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='a'))return;
    const snapshot=capture();if(same(snapshot,shown) || same(snapshot,dismissed))return;
    const ticket=++revision;if(!snapshot){shown=null;hide();return;}
    if(!allowed){const access=await enabled();if(ticket!==revision)return;allowed=access===true;}
    if(!allowed){hide();return;}
    const value=await selection(snapshot.range);if(ticket!==revision)return;if(!value || (!resolveSelection && !value.spans?.length)){hide();return;}
    saved=value;shown=snapshot;dismissed=null;create();const spans=value.spans;bar.querySelector('.passage-context').textContent=spans?.length?`¶${spans[0].n}–${spans.at(-1).n} · with surrounding context`:'Selected passage · with surrounding context';
    const rect=snapshot.range.getBoundingClientRect?.();
    const target=shadow?host:bar;target.style.left=Math.min(Math.max(12,rect?.left??12),Math.max(12,document.defaultView.innerWidth-330))+'px';target.style.top=Math.min(Math.max(12,(rect?.bottom??12)+8),Math.max(12,document.defaultView.innerHeight-110))+'px';bar.hidden=false;
    try{Promise.resolve(onPrepare()).catch(()=>{});}catch{/* Optional warm-up never hides a usable toolbar. */}
  }
  const listen=event=>{update(event).catch(hide);};
  document.addEventListener('pointerup',listen);document.addEventListener('keyup',listen);
  // A site grant/navigation may finish injecting after the user has selected text.
  queueMicrotask(()=>update().catch(hide));
  const escape=event=>{if(event.key==='Escape')dismiss();};document.addEventListener('keydown',escape);
  return {hide(){revision++;allowed=false;shown=null;hide();},setTheme(next){theme=next;if(host)host.dataset.theme=next;},dispose(){closed=true;clearTimeout(toastTimer);revision++;host?.remove();document.removeEventListener('pointerup',listen);document.removeEventListener('keyup',listen);document.removeEventListener('keydown',escape);}};
}
