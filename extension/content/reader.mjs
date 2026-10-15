import {extractHTML, extractSelectedHTML, highlightHTML, selectedHTMLBlocks,resolveHTMLAnchor} from '../../src/readers/html.mjs';
import {textMap} from '../../src/readers/html-text.mjs';
import {installSelectionToolbar} from '../ui/passage-toolbar.mjs';
// One listener per frame, including after an extension UI reconnect. Executed in Chrome's isolated world.
if (!globalThis.__sharhReader) {
  globalThis.__sharhReader = true;
  let current,ranges=[],viewportTimer=null,lastViewport='';const runtime=chrome.runtime,view=document.defaultView;
  function viewport(){viewportTimer=null;if(!current)return;const numbers=ranges.filter(({range})=>[...(range.getClientRects?.()??[])].some(r=>r.bottom>0&&r.top<view.innerHeight&&r.right>0&&r.left<view.innerWidth)).map(r=>r.n),key=current.version+':'+numbers.join(',');if(key===lastViewport)return;lastViewport=key;Promise.resolve(runtime.sendMessage({type:'sharh:viewport',version:current.version,numbers})).catch(()=>{});}
  const scrolled=()=>{if(viewportTimer===null)viewportTimer=setTimeout(viewport,100);};document.addEventListener('scroll',scrolled,{capture:true,passive:true});view.addEventListener('resize',scrolled);
  const toolbar=installSelectionToolbar({document,shadow:true,
    onPrepare:()=>chrome.runtime.sendMessage({type:'sharh:passage:prepare'}).catch(()=>{}),
    enabled:async()=>{const response=await chrome.runtime.sendMessage({type:'sharh:passage:enabled'});return response?.result===true;},
    // Capturing a DOM range is cheap. Extraction happens only after an action,
    // and never replaces the explicit reader's extraction/scope cache.
    selection:range=>({range,options:{mode:current?.mode??'article',region:current?.region??null}}),
    resolveSelection:async({range,options})=>{const result=await extractSelectedHTML(document,{...options,range});if(!result.selection?.spans?.length)throw Error('Select readable source text again.');return result;},
    onAction:(action,{selection,extraction})=>chrome.runtime.sendMessage({type:'sharh:passage:invoke',action,selection,extraction}).then(response=>{if(response?.error)throw Error(response.error);})});
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('sharh:reader:')) return;
    (async () => {
      switch (message.type) {
        case 'sharh:reader:passages-off': toolbar.hide();return true;
        case 'sharh:reader:extract':
          current = await extractHTML(document, {mode:message.mode || 'article',region:message.region || null});
          {const body=textMap(document.body);ranges=current.blocks.map(b=>({n:b.n,range:resolveHTMLAnchor(document,b.anchor,{body})?.range})).filter(b=>b.range);scrolled();}
          return {extraction:current, identity:document.URL, address:document.URL};
        case 'sharh:reader:selection':
          if (!current || current.version !== message.version) throw Error('REEXTRACT_REQUIRED');
          return selectedHTMLBlocks(document,current.blocks);
        case 'sharh:reader:highlight': return highlightHTML(document,message.anchor);
        default: throw Error('UNKNOWN_READER_OPERATION');
      }
    })().then(result => reply({result}), error => reply({error:error.message}));
    return true;
  });
}
