import {extractHTML, extractSelectedHTML, highlightHTML, selectedHTMLBlocks} from '../../src/readers/html.mjs';
import {installSelectionToolbar} from '../ui/passage-toolbar.mjs';
// One listener per frame, including after an extension UI reconnect. Executed in Chrome's isolated world.
if (!globalThis.__sharhReader) {
  globalThis.__sharhReader = true;
  let current;
  const toolbar=installSelectionToolbar({document,shadow:true,
    onPrepare:()=>chrome.runtime.sendMessage({type:'sharh:passage:prepare'}).catch(()=>{}),
    enabled:async()=>{const response=await chrome.runtime.sendMessage({type:'sharh:passage:enabled'});return response?.result===true;},
    selection:async()=>{const result=await extractSelectedHTML(document,{mode:current?.mode??'article',region:current?.region??null,includeNavigation:current?.includeNavigation===true});current=result.extraction;return result.selection;},
    onAction:(action,selection)=>chrome.runtime.sendMessage({type:'sharh:passage:invoke',action,selection,extraction:current}).then(response=>{if(response?.error)throw Error(response.error);})});
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('sharh:reader:')) return;
    (async () => {
      switch (message.type) {
        case 'sharh:reader:passages-off': toolbar.hide();return true;
        case 'sharh:reader:extract':
          current = await extractHTML(document, {mode:message.mode || 'article',region:message.region || null});
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
