import {watchPanelContext} from './panel-context.mjs';
import {bindRuns} from './runs.mjs';
import {PathClient} from './client.mjs';
import {diagnostic} from '../../src/paths/diagnostics.mjs';
const client = new PathClient();
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#check').addEventListener('click', async () => {
  const status = document.querySelector('#state');
  status.textContent = 'Checking…';
  try {
    const providers = await client.call('discover', {fresh: true}),
      list = document.querySelector('#providers');
    list.replaceChildren();
    for (const provider of providers) {
      const p = document.createElement('p');
      p.textContent = `${provider.label}: ${diagnostic(provider).title}`;
      list.append(p);
    }
    status.textContent = 'Check complete.';
  } catch (error) {
    status.textContent = error.message;
  }
});
// Reader/picker/toolbar and jobs call the same worker route when their surfaces are introduced.
export const prepare = (trigger, target) => client.call('prepare', {trigger, target});
export const {run} = bindRuns(client, {
  state: document.querySelector('#run-state'),
  retry: document.querySelector('#retry'),
  stop: document.querySelector('#stop')
});

const stopWatching = watchPanelContext(client);
window.addEventListener('pagehide', stopWatching, {once: true});
