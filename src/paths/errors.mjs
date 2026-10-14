const hints = {
  NOT_INSTALLED: 'Install Seatline and register it for this browser.',
  NOT_AUTHORIZED: 'Run the authorize command in Settings → Seatline.',
  SIGNED_OUT: 'Sign in to this provider’s CLI, then check again.',
  POLICY_DENIED: 'This sign-in is not accepted on the Seatline path.',
  RATE_LIMITED: 'Wait for your plan’s limit to reset or choose another target.',
  BUSY: 'Seatline is busy. Retry when a slot is free.',
  TOO_LARGE: 'Use a smaller scope or output limit.',
  TIMEOUT: 'Try a smaller scope or lower effort.',
  MODEL_UNSUPPORTED: 'Choose another model.',
  OPTION_UNSUPPORTED: 'Choose a supported option.',
  ISOLATION_UNAVAILABLE: 'Fix the CLI configuration so Seatline can disable tools.',
  UPDATE_REQUIRED: 'Update Seatline from a new build and run install again.',
  DISCONNECTED: 'Seatline disconnected. This turn was not replayed.',
  CANCELLED: 'The turn was stopped.',
  PROVIDER_FAILED: 'The provider could not complete this turn.'
};
export class PathError extends Error {
  constructor(code, reason = code, retryable = false, details = {}) {
    super(hints[code] || hints.PROVIDER_FAILED);
    this.name = 'PathError';
    Object.assign(this, {code, reason, retryable, hint: this.message}, details);
  }
}
const reasons = {
  EXECUTABLE_NOT_FOUND: 'NOT_INSTALLED',
  LOGIN_REQUIRED: 'SIGNED_OUT',
  AUTH_REJECTED: 'SIGNED_OUT',
  APP_NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  SIGN_IN_POLICY_DENIED: 'POLICY_DENIED',
  TOOL_ISOLATION_UNAVAILABLE: 'ISOLATION_UNAVAILABLE',
  PROVIDER_RATE_LIMITED: 'RATE_LIMITED',
  QUEUE_FULL: 'BUSY',
  QUEUE_TIMEOUT: 'BUSY',
  TURN_DEADLINE_EXCEEDED: 'TIMEOUT',
  PROVIDER_TIMEOUT: 'TIMEOUT',
  MODEL_NOT_SUPPORTED: 'MODEL_UNSUPPORTED',
  REASONING_EFFORT_UNSUPPORTED: 'OPTION_UNSUPPORTED',
  SERVICE_TIER_UNSUPPORTED: 'OPTION_UNSUPPORTED',
  PERSISTENT_SESSION_UNSUPPORTED: 'OPTION_UNSUPPORTED',
  UNKNOWN_SESSION: 'PROVIDER_FAILED',
  SESSION_LIMIT_REACHED: 'BUSY',
  READINESS_UNSUPPORTED: 'UPDATE_REQUIRED',
  READINESS_CHANGED: 'PROVIDER_FAILED',
  READINESS_EXPIRED: 'PROVIDER_FAILED',
  READINESS_UNVERIFIED: 'PROVIDER_FAILED'
};
export function failure(event, method) {
  const reason = event.reason;
  const code =
    reason === 'INVALID_REQUEST' && ['readiness', 'prepare', 'send_ready_with_policy'].includes(method)
      ? 'UPDATE_REQUIRED'
      : reasons[reason] || 'PROVIDER_FAILED';
  return new PathError(code, reason, event.retryable === true, {nativeCode: event.code});
}
export function nativeFailure(message = '', beforeReady = false) {
  if (/not found|not registered|specified native messaging host/i.test(message))
    return new PathError('NOT_INSTALLED', 'HOST_NOT_FOUND');
  if (/forbidden|not allowed|access.*denied/i.test(message) || beforeReady)
    return new PathError('NOT_AUTHORIZED', 'ORIGIN_NOT_AUTHORIZED');
  return new PathError('DISCONNECTED', 'PORT_DISCONNECTED', true);
}
export const cancelled = () => new PathError('CANCELLED');
