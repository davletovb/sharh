import {extractHTML, extractSelectedHTML, highlightHTML, selectedHTMLBlocks,resolveHTMLAnchor} from '../../src/readers/html.mjs';
import {ParagraphViewport} from '../ui/paragraph-viewport.mjs';
import {textMap} from '../../src/readers/html-text.mjs';
import {installSelectionToolbar} from '../ui/passage-toolbar.mjs';
// One listener per frame, including after an extension UI reconnect. Executed in Chrome's isolated world.
if (!globalThis.__sharhReader) {
  globalThis.__sharhReader = true;
  let current;const runtime=chrome.runtime,view=document.defaultView;
  const viewport=new ParagraphViewport((numbers,source)=>Promise.resolve(runtime.sendMessage({type:'sharh:viewport',version:source.version,numbers})).catch(()=>{}),{Observer:view.IntersectionObserver,schedule:fn=>setTimeout(fn,100)});
  const scrolled=()=>viewport.changed();document.addEventListener('scroll',scrolled,{capture:true,passive:true});view.addEventListener('resize',scrolled);
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
          {const body=textMap(document.body),groups=new Map();viewport.reset({version:current.version});for(const block of current.blocks){const range=resolveHTMLAnchor(document,block.anchor,{body})?.range;if(!range)continue;const node=range.commonAncestorContainer,element=node.nodeType===1?node:node.parentElement;if(!element)continue;if(!groups.has(element))groups.set(element,[]);groups.get(element).push({n:block.n,range});}for(const [element,ranges]of groups)viewport.observe(element,()=>ranges.filter(({range})=>[...(range.getClientRects?.()??[])].some(r=>r.bottom>0&&r.top<view.innerHeight&&r.right>0&&r.left<view.innerWidth)).map(r=>r.n));}
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
