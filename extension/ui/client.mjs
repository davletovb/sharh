import {PathError, cancelled} from '../../src/paths/errors.mjs';
// All surfaces share the worker's native connection. Reconnect the UI port for new calls, never replay lost work.
export class PathClient {
  constructor() {
    this.port = null;
    this.pending = new Map();
  }
  connect() {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({name: 'sharh:path'});
    this.port = port;
    port.onMessage.addListener((message) => {
      if (this.port !== port) return;
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
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      this.drop(port);
    });
    return port;
  }
  drop(port) {
    if (this.port !== port) return;
    this.port = null;
    for (const item of this.pending.values()) {
      item.dispose();
      item.reject(new PathError('DISCONNECTED', 'WORKER_DISCONNECTED', true));
    }
    this.pending.clear();
    try {
      port.disconnect();
    } catch {
      /* already closed */
    }
  }
  call(method, params = {}, {signal, onEvent} = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = this.connect();
      } catch {
        reject(new PathError('DISCONNECTED', 'WORKER_UNAVAILABLE', true));
        return;
      }
      const abort = () => {
        try {
          port.postMessage({id: crypto.randomUUID(), method: 'cancel', target: id});
        } catch {
          this.drop(port);
        }
      };
      this.pending.set(id, {
        resolve,
        reject,
        onEvent,
        dispose: () => signal?.removeEventListener('abort', abort)
      });
      signal?.addEventListener('abort', abort, {once: true});
      try {
        port.postMessage({...params, id, method});
      } catch {
        this.drop(port);
      }
    });
  }
}
