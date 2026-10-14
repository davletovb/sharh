// Runtime-owned sessions/groups never travel between profiles or machines.
export function portableRow(row) {
  const {session,sessionToken,sessionHandles,cleanupGroup,...portable}=row;
  return portable;
}
export function equalData(a,b) {
  if(a===b)return true;
  if(a instanceof Uint8Array || b instanceof Uint8Array) {
    if(!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
    return true;
  }
  if(!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key) && equalData(a[key],b[key]));
}
export function encodeBytes(value) {
  const bytes=new Uint8Array(value), chunks=[];
  // A multiple of three lets independently encoded chunks concatenate without internal padding.
  for(let start=0;start<bytes.length;start+=24576)chunks.push(btoa(String.fromCharCode(...bytes.subarray(start,start+24576))));
  return {encoding:'base64',data:chunks.join('')};
}
export function decodeBytes(value,version) {
  if(version===1 && Array.isArray(value) && value.every(b=>Number.isInteger(b)&&b>=0&&b<=255))return new Uint8Array(value);
  if(value?.encoding!=='base64' || typeof value.data!=='string' || value.data.length%4!==0)throw Error('INVALID_SOURCE_BYTES');
  const padding=value.data.endsWith('==')?2:value.data.endsWith('=')?1:0;
  if(/[^A-Za-z0-9+/]/.test(value.data.slice(0,value.data.length-padding)))throw Error('INVALID_SOURCE_BYTES');
  const binary=atob(value.data), bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
