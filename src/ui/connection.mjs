// Turns the provider checks into the three setup steps a reader sees, and one overall answer.
import {diagnostic} from '../paths/diagnostics.mjs';
export function connectionSteps(results) {
  const states = results.map(p => diagnostic(p).state);
  const hostMissing = states.length > 0 && states.every(s => s === 'companion_missing');
  const notAuthorized = !hostMissing && states.length > 0 && states.every(s => s === 'sharh_not_authorized');
  const ready = results.filter((p, i) => states[i] === 'ready');
  const steps = {
    install: hostMissing ? 'bad' : 'ok',
    authorize: hostMissing ? 'wait' : notAuthorized ? 'bad' : 'ok',
    signin: hostMissing || notAuthorized ? 'wait' : ready.length ? 'ok' : 'bad'
  };
  const next = steps.install === 'bad' ? 'Install Seatline to get started.' : steps.authorize === 'bad' ? 'Allow Sharh to use Seatline with the authorize command.' : 'Sign in to a model CLI, then check again.';
  return {steps, ready, connected: ready.length > 0, next};
}
