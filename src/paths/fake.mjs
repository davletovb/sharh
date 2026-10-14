import {cancelled,PathError} from './errors.mjs';
import {bytes,outputLimit,MAX_REQUEST_BYTES} from './limits.mjs';
const defaultWait=(ms,signal)=>new Promise((resolve,reject)=> {
  if(signal?.aborted){reject(cancelled());return;}
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(finish,ms),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(cancelled());};
  signal?.addEventListener('abort',abort,{once:true});
});
// Explicitly injected scripts; never selected automatically by a production request.
export class FakePath {
  id='fake';label='Scripted test path';
  constructor({scripts=[],scriptFor=null,sessions=true,wait=defaultWait,delayMs=8}={}) {
    Object.assign(this,{scripts:[...scripts],scriptFor,sessions,wait,delayMs});this.calls=[];this.maintenance=[];this.handles=new Set();this.nextHandle=0;
  }
  async discover() {return [{path:'fake',provider:'fixture',available:true,signedIn:true,accepted:true,models:[],capabilities:{streaming:true,sessions:this.sessions,toolIsolation:true,maxRequestBytes:MAX_REQUEST_BYTES}}];}
  async prepare() {}
  async run(target,request,{signal,onEvent=()=>{}}={}) {
    if(signal?.aborted)throw cancelled();
    if(bytes(JSON.stringify(request))>MAX_REQUEST_BYTES)throw new PathError('TOO_LARGE');
    this.calls.push(structuredClone({target,request}));
    const mode=request.session?.mode??'none';
    if(request.session?.mode==='continue' && !this.handles.has(request.session.handle))throw new PathError('PROVIDER_FAILED','UNKNOWN_SESSION');
    if(mode!=='none' && !this.sessions)throw new PathError('OPTION_UNSUPPORTED','PERSISTENT_SESSION_UNSUPPORTED');
    const script=this.scriptFor?await this.scriptFor({target,request}):this.scripts.shift();if(!script)throw Error('FAKE_SCRIPT_EXHAUSTED');
    onEvent({type:'started'});
    let session=null;
    if(mode!=='none') {session=request.session?.handle??`fake_session_${++this.nextHandle}`;this.handles.add(session);onEvent({type:'session',handle:session});}
    let text='',used=0,truncated=script.truncated===true;
    const chunks=script.chunks??(script.text??'').match(/[\s\S]{1,73}/gu)??[],cap=outputLimit(request.tier??request.kind,request.limits?.maxOutputBytes);
    for(const chunk of chunks) {
      await this.wait(typeof chunk==='string'?this.delayMs:chunk.delayMs??this.delayMs,signal);
      if(signal?.aborted)throw cancelled();
      const delta=typeof chunk==='string'?chunk:chunk.text;
      let kept='';for(const point of delta) {const size=bytes(point);if(used+size>cap){truncated=true;break;}kept+=point;used+=size;}
      text+=kept;if(kept)onEvent({type:'delta',text:kept});if(kept!==delta)break;
    }
    if(script.sessionLost) {session=null;onEvent({type:'session_lost',confirmed:true});}
    if(script.error)throw Object.assign(Error(script.error.code),script.error);
    const usage=script.usage??null;if(usage)onEvent({type:'usage',usage});
    onEvent({type:'completed'});
    return {text,truncated,usage,session,target:structuredClone(target),sources:[]};
  }
  async forget(target,handles) {this.maintenance.push({method:'forget',target,handles});for(const h of handles)this.handles.delete(h);}
  async cleanup(target,group) {this.maintenance.push({method:'cleanup',target,group});}
}
