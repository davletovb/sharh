// Shared selection interaction for source pages and the PDF/local-text reader.
export function installSelectionToolbar({document,selection,onAction,enabled=async()=>true,onPrepare=()=>{},shadow=false}) {
  let host,bar,saved,revision=0,closed=false;
  function hide(){bar?.setAttribute('hidden','');}
  function create() {
    if(bar)return;host=document.createElement('div');host.dataset.sharhToolbar='true';
    const root=shadow?host.attachShadow({mode:'closed'}):host;
    if(shadow){const style=document.createElement('style');style.textContent=':host{all:initial;position:fixed;z-index:2147483647;font:14px/1.5 system-ui,sans-serif;color:#252a2e} [hidden]{display:none!important}.passage-toolbar{background:#fffaf0;color:#252a2e;border:1px solid #735414;border-radius:8px;padding:8px;box-shadow:0 8px 28px #0004;max-width:calc(100vw - 24px)}button{font:inherit;background:#735414;color:#fff;border:0;border-radius:5px;padding:7px;margin:3px;cursor:pointer;min-height:36px}button:focus-visible{outline:3px solid #145d99;outline-offset:2px}p{font-size:12px;margin:2px 0} @media(prefers-color-scheme:dark){.passage-toolbar{background:#192630;color:#f1e9da}button{background:#e8c477;color:#16212c}}';root.append(style);}
    bar=document.createElement('div');bar.className='passage-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Passage actions');
    const hint=document.createElement('p');hint.className='passage-context';bar.append(hint);
    for(const action of ['Explain','Translate','Logic','Define']) {
      const b=document.createElement('button');b.type='button';b.textContent=action;
      b.addEventListener('pointerdown',e=>e.preventDefault());
      b.addEventListener('click',()=>{const chosen=saved;hide();if(chosen)Promise.resolve(onAction(action,chosen)).catch(error=>{hint.textContent=error.message;bar.hidden=false;});});bar.append(b);
    }
    bar.addEventListener('keydown',e=>{const buttons=[...bar.querySelectorAll('button')],at=buttons.indexOf(root.activeElement??document.activeElement);if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();}if(e.key==='Escape'){hide();document.defaultView.getSelection()?.removeAllRanges();}});
    root.append(bar);document.body.append(host);hide();
  }
  async function update(event) {
    if(closed || event?.composedPath().includes(host))return;const ticket=++revision;
    if(!document.defaultView.getSelection()?.toString().trim()){hide();return;}
    if(!await enabled() || ticket!==revision){hide();return;}
    const value=await selection();if(ticket!==revision || !value?.spans?.length){hide();return;}
    saved=value;create();const spans=value.spans;bar.querySelector('.passage-context').textContent=`¶${spans[0].n}–${spans.at(-1).n} · with surrounding context`;
    const selected=document.defaultView.getSelection(),rect=selected?.rangeCount?selected.getRangeAt(0).getBoundingClientRect():null;
    const target=shadow?host:bar;target.style.left=Math.min(Math.max(12,rect?.left??12),Math.max(12,document.defaultView.innerWidth-330))+'px';target.style.top=Math.min(Math.max(12,(rect?.bottom??12)+8),Math.max(12,document.defaultView.innerHeight-110))+'px';bar.hidden=false;onPrepare();
  }
  const listen=event=>{update(event).catch(hide);};
  document.addEventListener('pointerup',listen);document.addEventListener('keyup',listen);
  const dismiss=event=>{if(event.key==='Escape'){revision++;hide();}};document.addEventListener('keydown',dismiss);
  return {hide(){revision++;hide();},dispose(){closed=true;revision++;host?.remove();document.removeEventListener('pointerup',listen);document.removeEventListener('keyup',listen);document.removeEventListener('keydown',dismiss);}};
}
