import {probeClient, probeStatuses} from './lib/probe-client.mjs';
const contract = await (await fetch('./contract.json')).json();
document.querySelector('#command').textContent = `seatline-companion authorize sharh ${contract.providers.join(',')} chrome-extension://${chrome.runtime.id}/ --cache-title=Sharh`;
export async function checkAuthorization(host = contract.native_host) {
  let client;
  try {
    const port = chrome.runtime.connectNative(host);
    port.errorMessage = () => chrome.runtime.lastError?.message;
    client = probeClient(port, {timeoutMs: 15000});
    const ready = await client.ready;
    return {kind: 'chrome-native', extensionId: chrome.runtime.id, ready, providers: await probeStatuses(client, contract.providers)};
  } catch (error) { return {kind: 'chrome-native', extensionId: chrome.runtime.id, error: error.message}; }
  finally { client?.close(); }
}
window.checkAuthorization = checkAuthorization;
document.querySelector('#check').addEventListener('click', async () => {
  const result = document.querySelector('#result'); result.textContent = 'Checking…';
  result.textContent = JSON.stringify(await checkAuthorization(), null, 2);
});
