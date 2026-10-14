import {bytes,MAX_REQUEST_BYTES,measureRequest} from '../paths/limits.mjs';
import {generationFrame} from '../paths/seatline.mjs';
import {PathError} from '../paths/errors.mjs';
export function requestPreview(target,request) {
  const requestBytes=target.path==='seatline'?measureRequest(generationFrame(target,request,{allowGeminiCloud:true})):bytes(JSON.stringify(request));
  const hint=requestBytes>MAX_REQUEST_BYTES?'Choose a smaller scope or start a new analysis with less history.':null;
  const text=[request.rules,request.document,request.task].filter(Boolean).join('\n');
  return {estimatedTokens:Math.ceil([...text].length/3),requestBytes,maxRequestBytes:MAX_REQUEST_BYTES,fits:!hint,hint};
}
export function preflightRequest(target,request) {
  const preview=requestPreview(target,request);
  if(!preview.fits)throw new PathError('TOO_LARGE','REQUEST_TOO_LARGE',false,{...preview,canContinue:false});
  return preview;
}
