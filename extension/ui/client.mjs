// All extension surfaces share the service worker's single native connection.
export class PathClient {
  constructor() {
    this.port = chrome.runtime.connect({name: 'sharh:path'});
    this.pending = new Map();
    this.port.onMessage.addListener((message) => {
      const item = this.pending.get(message.id);
      if (!item) return;
      if (message.event) {
        try {
          item.onEvent?.(message.event);
        } catch {
          /* view observer */
        }
        return;
      }
      this.pending.delete(message.id);
      item.dispose();
      message.error
        ? item.reject(Object.assign(Error(message.error.hint), message.error))
        : item.resolve(message.result);
    });
    this.port.onDisconnect.addListener(() => {
      for (const item of this.pending.values()) {
        item.dispose();
        item.reject(Object.assign(Error('Seatline disconnected.'), {code: 'DISCONNECTED'}));
      }
      this.pending.clear();
    });
  }
  call(method, params = {}, {signal, onEvent} = {}) {
    if (signal?.aborted) return Promise.reject(Object.assign(Error('Stopped'), {code: 'CANCELLED'}));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => this.port.postMessage({id: crypto.randomUUID(), method: 'cancel', target: id});
      this.pending.set(id, {
        resolve,
        reject,
        onEvent,
        dispose: () => signal?.removeEventListener('abort', abort)
      });
      signal?.addEventListener('abort', abort, {once: true});
      try {
        this.port.postMessage({id, method, ...params});
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }
}
