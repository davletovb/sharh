import {scopeDescriptor,scopeKey,PROMPT_VERSION,assemblePrompt} from '../analysis/prompts.mjs';
import {targetKey} from '../paths/targets.mjs';
const identity=config=>assemblePrompt(config.doc,config.scope,{...config,customLens:null,lens:'passage',action:null,operation:'ask',question:'',history:[],session:{mode:'none'}}).promptKey;
export class Conversations {
  constructor(engine){this.engine=engine;this.store=engine.store;}
  async list(docId){return (await this.store.all('chats')).filter(c=>c.docId===docId).sort((a,b)=>b.updatedAt-a.updatedAt);}
  async create(config,{passageIntentId=null}={}){config=await this.engine.withGlossary(config);const chat={schemaVersion:1,id:crypto.randomUUID(),docId:config.doc.id,extractionVersion:config.doc.version,scope:scopeDescriptor(config.scope),scopeKey:scopeKey(config.scope),target:structuredClone(config.target),language:config.language??'en',promptVersion:PROMPT_VERSION,glossary:structuredClone(config.glossary??[]),instructionKey:identity(config),turns:[],createdAt:Date.now(),updatedAt:Date.now(),...(passageIntentId?{passageIntentId}:{})};await this.store.writeOwned('chats',chat);return chat;}
  async open(id){const chat=(await this.store.all('chats')).find(c=>c.id===id);if(!chat)throw Error('CHAT_REMOVED');return {...chat,answers:await Promise.all(chat.turns.map(t=>this.engine.repository.get(t.runId)))};}
  // A turn can say which finding of an earlier reading it is about, and carry a short label to show in place of the full text.
  static about(value){
    if(value==null)return null;
    if(typeof value!=='object' || typeof value.runId!=='string' || !value.runId || !Number.isSafeInteger(value.sequence) || value.sequence<0 || !['question','finding'].includes(value.kind) || typeof (value.text??'')!=='string' || (value.text??'').length>2000)throw Error('INVALID_ABOUT');
    return {runId:value.runId,sequence:value.sequence,kind:value.kind,...(value.text?{text:value.text}:{})};
  }
  async ask(config,question,{chatId=null,about=null,label=null,...options}={}){
    about=Conversations.about(about);if(label!=null&&(typeof label!=='string' || label.length>200))throw Error('INVALID_LABEL');
    config=await this.engine.withGlossary(config);question=question.trim();if(!question || question.length>12000)throw Error('Ask a question of at most 12,000 characters.');
    const {doc,scope,target}=config,id=chatId??crypto.randomUUID();
    return this.engine.ownership.hold('chat-'+id,async()=>{
      const previous=chatId?await this.open(id):null;if(previous)config={...config,glossary:previous.glossary??[]};const instructionKey=identity(config);
      let chat=previous??{schemaVersion:1,id,docId:doc.id,extractionVersion:doc.version,scope:scopeDescriptor(scope),scopeKey:scopeKey(scope),target:structuredClone(target),language:config.language??'en',promptVersion:PROMPT_VERSION,glossary:structuredClone(config.glossary??[]),instructionKey,turns:[],createdAt:Date.now()};
      if(chat.docId!==doc.id || chat.extractionVersion!==doc.version || chat.scopeKey!==scopeKey(scope) || targetKey(chat.target)!==targetKey(target) || chat.language!==(config.language??'en') || chat.promptVersion!==PROMPT_VERSION || chat.instructionKey!==instructionKey)throw Error('The scope, model or instructions changed. Start a new conversation.');
      const answers=chat.answers??[],history=chat.turns.flatMap((t,i)=>{const answer=answers[i],text=(answer?.records??[]).map(e=>JSON.stringify(e.record)).join('\n');return answer?.run.status==='completed'&&text?[{role:'user',text:t.question},{role:'assistant',text}]:[];});
      delete chat.answers;const last=answers.at(-1)?.run;
      if(history.length>100)throw Error('This conversation is full. Start a new conversation.');
      // A new turn is explicit. Opening/restoring history never retries a turn.
      const request={...config,customLens:null,lens:'passage',action:null,operation:'ask',question,history,followRunId:last?.status==='completed'?last.id:null};
      let turn;
      try{
        const saved=await this.engine.start(request,{...options,onBegin:async run=>{turn={question,runId:run.id,createdAt:Date.now(),...(about?{about}:{}),...(label?{label}:{})};chat.turns.push(turn);chat.updatedAt=Date.now();await this.store.writeOwned('chats',chat);await options.onBegin?.(run);},allowSavedExtraction:true});
        return {...saved,chatId:id};
      }catch(error){if(turn)error.chatId=id;throw error;}
    });
  }
}
