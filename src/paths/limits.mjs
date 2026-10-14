import contract from '../../config/seatline-contract.json' with {type: 'json'};
import {PathError} from './errors.mjs';
export const MAX_REQUEST_BYTES = contract.reading_policy.max_request_bytes;
export const SESSION_HANDLE = /^[A-Za-z0-9_-]{1,256}$/;
export const CLEANUP_GROUP = /^[A-Za-z0-9_-]{1,64}$/;
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
export const OUTPUT_CAPS = Object.freeze({
  quick: 32768,
  repair: 32768,
  analysis: 262144,
  chat: 262144,
  search: 262144,
  synthesis: 524288
});
const encoder = new TextEncoder(),
  turnSizes = new WeakMap();
export const bytes = (text) => encoder.encode(text).byteLength;
export const codePointBytes = (point) => {
  const code = point.codePointAt(0);
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
};
// Only turns made immutable here are cached. Neither caller history nor mutable arbitrary wire params enter the cache.
export function sealTurn(turn) {
  for (const message of turn.messages) Object.freeze(message);
  Object.freeze(turn.messages);
  Object.freeze(turn);
  turnSizes.set(turn, bytes(JSON.stringify(turn)));
  return turn;
}
export function measureRequest(frame) {
  const size = turnSizes.get(frame.params?.turn);
  return size === undefined
    ? bytes(JSON.stringify(frame))
    : bytes(JSON.stringify({...frame, params: {...frame.params, turn: null}})) + size - 4;
}
export function checkRequest(frame) {
  if (measureRequest(frame) > MAX_REQUEST_BYTES) throw new PathError('TOO_LARGE', 'REQUEST_TOO_LARGE');
}
export function outputLimit(kind = 'analysis', value = OUTPUT_CAPS[kind]) {
  if (!Number.isSafeInteger(value) || value < 1 || !OUTPUT_CAPS[kind] || value > OUTPUT_CAPS[kind])
    throw new PathError('TOO_LARGE', 'INVALID_OUTPUT_LIMIT');
  return value;
}
