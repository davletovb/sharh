import {PathClient} from './client.mjs';
import {authorizeCommand, diagnostic} from '../../src/paths/diagnostics.mjs';
const client = new PathClient(),
  $ = (selector) => document.querySelector(selector);
$('#authorize').textContent = authorizeCommand(chrome.runtime.id);
$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#authorize').textContent);
    $('#copied').textContent = 'Copied';
  } catch {
    $('#copied').textContent = 'Select and copy the command above.';
  }
});
const saved = await chrome.storage.local.get('seatlinePolicy');
$('#gemini-cloud').checked = saved.seatlinePolicy?.allowGeminiCloud === true;
$('#gemini-cloud').addEventListener('change', async () => {
  await chrome.storage.local.set({seatlinePolicy: {allowGeminiCloud: $('#gemini-cloud').checked}});
  await check();
});
async function check() {
  $('#check').disabled = true;
  $('#check-state').textContent = 'Checking…';
  try {
    const providers = await client.call('discover', {fresh: true});
    $('#diagnostics').replaceChildren();
    for (const provider of providers) {
      const state = diagnostic(provider),
        card = document.createElement('article'),
        title = document.createElement('h3'),
        detail = document.createElement('p');
      card.dataset.state = state.state;
      title.textContent = `${provider.label} · ${state.title}`;
      detail.textContent = state.hint;
      card.append(title, detail);
      $('#diagnostics').append(card);
    }
    $('#check-state').textContent = 'Fresh check complete.';
  } catch (error) {
    $('#check-state').textContent = error.message;
  } finally {
    $('#check').disabled = false;
  }
}
