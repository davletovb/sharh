import contract from '../../config/seatline-contract.json' with {type: 'json'};
export function authorizeCommand(extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw Error('INVALID_EXTENSION_ID');
  return `seatline-companion authorize ${contract.app} ${contract.providers.join(',')} chrome-extension://${extensionId}/ --cache-title=Sharh`;
}
const states = {
  companion_missing: [
    'Companion missing',
    'Install Seatline and register it for this browser if it is not Google Chrome.'
  ],
  sharh_not_authorized: [
    'Sharh not authorized',
    'Run the authorize command shown on this page. It replaces the grant; include every provider and origin you use.'
  ],
  extension_too_old: ['Sharh too old', 'Update Sharh to work with this Seatline version.'],
  companion_too_old: [
    'Companion too old',
    'Update Seatline from a new build, then run seatline-companion install.'
  ],
  provider_not_authorized: [
    'Provider not authorized',
    'Add this provider to the Sharh grant using the authorize command shown on this page.'
  ],
  cli_missing: ['CLI missing', 'Install this provider’s CLI.'],
  signed_out: ['Signed out', 'Sign in to this provider’s CLI, then check again.'],
  sign_in_not_accepted: [
    'Sign-in not accepted',
    'Seatline accepts subscription sign-ins. Gemini requires the explicit Antigravity cloud opt-in under Sign-in policy. API keys and unknown sign-ins are refused.'
  ],
  isolation_unavailable: [
    'Isolation unavailable',
    'The CLI configuration exposes tools Seatline cannot switch off. Fix that configuration before running.'
  ],
  ready: ['Ready', 'Available, signed in and accepted for turns without tools.'],
  disconnected: ['Disconnected', 'Seatline disconnected. Check again to reconnect.'],
  provider_failed: ['Check failed', 'The provider could not be checked. Try again.']
};
export function diagnostic(info) {
  const reason = info.error?.reason,
    code = info.error?.code;
  let state;
  if (reason === 'HOST_NOT_FOUND') state = 'companion_missing';
  else if (['ORIGIN_NOT_AUTHORIZED', 'READY_TIMEOUT'].includes(reason)) state = 'sharh_not_authorized';
  else if (reason === 'EXTENSION_UPDATE_REQUIRED') state = 'extension_too_old';
  else if (code === 'UPDATE_REQUIRED') state = 'companion_too_old';
  else if (reason === 'APP_NOT_AUTHORIZED') state = 'provider_not_authorized';
  else if (reason === 'EXECUTABLE_NOT_FOUND' || (!info.error && info.availability === 'not_found'))
    state = 'cli_missing';
  else if (
    ['LOGIN_REQUIRED', 'AUTH_REJECTED'].includes(reason) ||
    (!info.error && info.authentication === 'unauthenticated')
  )
    state = 'signed_out';
  else if (!info.error && (!info.available || !info.signedIn)) state = 'provider_failed';
  else if (reason === 'SIGN_IN_POLICY_DENIED' || (!info.error && !info.accepted))
    state = 'sign_in_not_accepted';
  else if (reason === 'TOOL_ISOLATION_UNAVAILABLE' || (!info.error && !info.capabilities.toolIsolation))
    state = 'isolation_unavailable';
  else if (code === 'DISCONNECTED') state = 'disconnected';
  else state = info.error ? 'provider_failed' : 'ready';
  return {state, title: states[state][0], hint: states[state][1]};
}
export function runState(event) {
  if (event.type === 'retrying') return 'Refreshing readiness…';
  if (event.type === 'queued' && event.local)
    return event.reason === 'maintenance'
      ? 'Waiting for Seatline maintenance.'
      : 'Waiting for the current background turn.';
  if (event.type === 'queued') return `Waiting for a free slot (${event.ahead} ahead)`;
  if (event.type === 'busy')
    return event.retryAfter
      ? `Seatline is busy. Retrying in ${event.retryAfter / 1000} seconds.`
      : 'Seatline is busy. Retry when a slot is free.';
  if (['admitted', 'started'].includes(event.type)) return 'Running';
  if (event.type === 'completed') return 'Completed';
  if (event.type === 'stopped') return 'Stopped';
  return null;
}
