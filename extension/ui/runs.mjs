import {runState} from '../../src/paths/diagnostics.mjs';
// Bound now; document/lens surfaces provide targets and requests in E. Retrying always needs a reader action.
export function bindRuns(client, {state, retry, stop}) {
  let previous, active;
  retry.addEventListener('click', () => {
    if (previous) run(...previous).catch(() => {});
  });
  stop.addEventListener('click', () => active?.abort());
  async function run(target, request) {
    if (active) throw Error('A foreground action is already running.');
    previous = [target, request];
    active = new AbortController();
    retry.hidden = true;
    stop.hidden = false;
    state.textContent = 'Connecting…';
    try {
      const result = await client.call(
        'run',
        {target, request},
        {
          signal: active.signal,
          onEvent: (event) => {
            const text = runState(event);
            if (text) state.textContent = text;
          }
        }
      );
      state.textContent = result.truncated
        ? 'Output limit reached. The partial result was kept.'
        : 'Completed';
      return result;
    } catch (error) {
      state.textContent = error.hint || error.message;
      retry.hidden =
        error.code === 'BUSY'
          ? !['QUEUE_FULL', 'QUEUE_TIMEOUT'].includes(error.reason)
          : !['DISCONNECTED', 'RATE_LIMITED', 'TIMEOUT'].includes(error.code);
      throw error;
    } finally {
      active = null;
      stop.hidden = true;
    }
  }
  return {run};
}
