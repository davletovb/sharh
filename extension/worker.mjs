import {NativeSeatline} from '../src/paths/native-seatline.mjs';
import {SeatlinePath} from '../src/paths/seatline.mjs';
import {SeatlinePreferences} from './lib/preferences.mjs';
import {installOpening,createReaderMenus} from './lib/opening.mjs';
import {openDocumentStore} from '../src/documents/store.mjs';
import {MaintenanceDispatcher} from '../src/analysis/maintenance.mjs';
import {SESSION_HANDLE} from '../src/paths/limits.mjs';
import {installPassages,installPassageBadge} from './lib/passages.mjs';
installOpening(chrome);
const preferences = new SeatlinePreferences(chrome.storage);
const client = new NativeSeatline((host) => chrome.runtime.connectNative(host), {
  disconnectMessage: () => chrome.runtime.lastError?.message || ''
});
const path = new SeatlinePath({client, policy: () => preferences.value});
installPassages(chrome,{prepare:async()=>{const {sharhReading}=await chrome.storage.local.get('sharhReading');await path.prepareFor('passage-toolbar',sharhReading?.tiers?.quick??{path:'seatline',provider:'claude'});}});
installPassageBadge(chrome);
const databases=new Map();
function documentServices(name='sharh') {
  if(typeof name!=='string' || !name || name.length>128)throw Error('INVALID_DATABASE');
  if(!databases.has(name)) {
    const documents=openDocumentStore({name});
    databases.set(name,{documents,maintenance:documents.then(store=>new MaintenanceDispatcher(store,{seatline:path}))});
  }
  return databases.get(name);
}
const {maintenance}=documentServices();
// Retry durable deletion intentions on worker activation. Failed rows remain local.
preferences.refresh().then(()=>maintenance).then(dispatcher=>dispatcher.drain()).catch(()=>{});
chrome.runtime.onInstalled.addListener(() => {
  createReaderMenus(chrome).catch(() => {});
});
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'sharh:path' ||
    port.sender?.id !== chrome.runtime.id ||
    !port.sender.url?.startsWith(chrome.runtime.getURL(''))
  ) {
    port.disconnect();
    return;
  }
  const running = new Map();
  let connected = true;
  const send = (message) => {
    if (connected)
      try {
        port.postMessage(message);
      } catch {
        /* page closed */
      }
  };
  port.onDisconnect.addListener(() => {
    connected = false;
    for (const controller of running.values()) controller.abort();
  });
  port.onMessage.addListener(async (message) => {
    if (!message || typeof message.id !== 'string' || message.id.length > 128) return;
    if (message.method === 'cancel') {
      running.get(message.target)?.abort();
      return;
    }
    if (running.has(message.id)) return;
    const controller = new AbortController();
    running.set(message.id, controller);
    try {
      await preferences.refresh();
      let result;
      switch (message.method) {
        case 'maintenance':
          result=await (await maintenance).drain();
          break;
        case 'discover':
          result = await path.discover({fresh: message.fresh === true});
          break;
        case 'prepare':
          result = await path.prepareFor(message.trigger, message.target, {signal: controller.signal});
          break;
        case 'run':
          result = await path.run(message.target, message.request, {
            signal: controller.signal,
            onEvent: (event) => {
              // Keep broker-owned handles even if the requesting page closes or its document
              // was deleted before the session event arrived. This never parses model text.
              if(event.type==='session' && message.request.session?.mode!=='none' && typeof event.handle==='string' && SESSION_HANDLE.test(event.handle) &&
                typeof message.analysisRunId==='string' && message.analysisRunId.length<=128) {
                const service=documentServices(message.analysisDatabase);
                service.documents.then(store=>store.rememberSession({id:message.analysisRunId,target:message.target,cleanupGroup:message.request.cleanupGroup},event.handle))
                  .then(exists=>exists?null:service.maintenance.then(dispatcher=>dispatcher.drain())).catch(()=>{});
              }
              send({id:message.id,event});
            }
          });
          if (message.request.priority === 'interactive')
            await chrome.storage.local.set({seatlineTarget: result.target}).catch(() => {});
          break;
        case 'forget':
          result = await path.forget(message.target, message.handles);
          break;
        case 'cleanup':
          result = await path.cleanup(message.target, message.group);
          break;
        default:
          throw Error('Unknown operation');
      }
      send({id: message.id, result: result ?? null});
    } catch (error) {
      send({
        id: message.id,
        error: {
          code: error.code || 'PROVIDER_FAILED',
          reason: error.reason || 'INVALID_REQUEST',
          hint: error.hint || 'This request could not be completed.',
          retryable: error.retryable === true
        }
      });
    } finally {
      running.delete(message.id);
    }
  });
});
