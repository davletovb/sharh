import {extractHTML, highlightHTML, selectedHTMLBlocks} from '../../src/readers/html.mjs';
// One listener per frame, including after an extension UI reconnect. Executed in Chrome's isolated world.
if (!globalThis.__sharhReader) {
  globalThis.__sharhReader = true;
  let current;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('sharh:reader:')) return;
    (async () => {
      switch (message.type) {
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
