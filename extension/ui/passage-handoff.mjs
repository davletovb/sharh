// The caller holds the window's Web Lock. Failed setup keeps the intention;
// an accepted run journals its ID before acknowledgement or any provider send.
export async function acceptPassage({key,storage,store,engine,show,onPassage,onSaved,onAsk,isActive=()=>false}) {
  const value=(await storage.get(key))[key];if(!value)return null;
  if(isActive())throw Error('Stop the current run before starting another. Your passage is waiting; retry it when the run finishes.');
  const doc=await store.getDocument(value.docId,value.version);if(!doc)throw Error('The selected document was deleted. Dismiss this pending action and select another passage.');
  if(isActive())throw Error('Stop the current run before starting another. Your passage is waiting; retry it when the run finishes.');
  await show(doc,value);
  const acknowledge=async()=>{if((await storage.get(key))[key]?.id===value.id)await storage.remove(key);};
  if(value.action==='Ask about this'){const existing=(await store.all('chats')).find(c=>c.passageIntentId===value.id);if(existing){await onAsk?.(existing.id);await acknowledge();return {chatId:existing.id,restored:true};}}
  const existing=(await engine.repository.list(doc.id)).find(r=>r.passageIntentId===value.id);
  if(existing){await onSaved(existing.id);await acknowledge();return {runId:existing.id,restored:true};}
  return onPassage(value.action,value.selection,{intentId:value.id,onAccepted:acknowledge});
}
