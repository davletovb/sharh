import contract from '../../config/seatline-contract.json' with {type: 'json'};
// Tab IDs/events are available without tabs/host permission. Hidden URLs are possible documents, not a reason to skip preparation.
export function watchPanelContext(client, {tabs = chrome.tabs, storage = chrome.storage} = {}) {
  let activeId,
    closed = false;
  const prepare = async () => {
    try {
      const [tab] = await tabs.query({active: true, currentWindow: true});
      if (closed || !tab) return;
      activeId = tab.id;
      if (tab.url && !/^(https?:|file:)/.test(tab.url)) return;
      const {seatlineTarget} = await storage.local.get('seatlineTarget');
      const target =
        seatlineTarget?.path === 'seatline' && contract.providers.includes(seatlineTarget.provider)
          ? seatlineTarget
          : {path: 'seatline', provider: 'claude'}; // provisional A-05 default, until a target is chosen
      if (!closed) await client.call('prepare', {trigger: 'panel-document', target});
    } catch {
      /* unsolicited preparation is quiet */
    }
  };
  const activated = () => void prepare();
  const updated = (id, change) => {
    if (id === activeId && change.status === 'complete') void prepare();
  };
  const changed = (changes, area) => {
    if (area === 'local' && changes.seatlineTarget) void prepare();
  };
  tabs.onActivated.addListener(activated);
  tabs.onUpdated.addListener(updated);
  storage.onChanged.addListener(changed);
  void prepare();
  return () => {
    closed = true;
    tabs.onActivated.removeListener(activated);
    tabs.onUpdated.removeListener(updated);
    storage.onChanged.removeListener(changed);
  };
}
