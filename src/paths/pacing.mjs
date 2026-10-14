import {cancelled} from './errors.mjs';
export function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(cancelled()),
      timer = setTimeout(() => finish(), ms);
    signal?.addEventListener('abort', abort, {once: true});
  });
}
// Local waiting never consumes a broker slot. Interactive turns may pass waiting maintenance until it starts.
export class RequestPacer {
  constructor({sleep = delay, onActivity = () => {}} = {}) {
    this.sleep = sleep;
    this.onActivity = onActivity;
    this.waiting = [];
    this.active = new Map();
    this.background = false;
    this.maintenance = new Set();
  }
  run(provider, priority, work, options = {}) {
    return this.enqueue(provider, priority, work, options);
  }
  maintain(provider, work) {
    return this.enqueue(provider, 'maintenance', work, {});
  }
  enqueue(provider, priority, work, {signal, onEvent = () => {}}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const item = {provider, priority, work, signal, onEvent, resolve, reject};
      item.abort = () => {
        const i = this.waiting.indexOf(item);
        if (i >= 0) {
          this.waiting.splice(i, 1);
          reject(cancelled());
          this.drain();
        }
      };
      this.waiting.push(item);
      signal?.addEventListener('abort', item.abort, {once: true});
      this.drain();
    });
  }
  drain() {
    for (let i = 0; i < this.waiting.length; i++) {
      const item = this.waiting[i],
        {provider, priority} = item;
      if (this.maintenance.has(provider)) {
        this.wait(item, 'maintenance');
        continue;
      }
      if (priority === 'maintenance') {
        if (this.active.get(provider)) continue;
      } else if (
        (this.waiting.some((j) => j.provider === provider && j.priority === 'maintenance') &&
          (priority === 'background' || !this.active.get(provider))) ||
        (priority === 'background' && this.background)
      ) {
        this.wait(item, priority === 'background' && this.background ? 'background' : 'maintenance');
        continue;
      }
      this.waiting.splice(i--, 1);
      item.signal?.removeEventListener('abort', item.abort);
      if (priority === 'maintenance') this.maintenance.add(provider);
      if (priority === 'background') this.background = true;
      this.active.set(provider, (this.active.get(provider) || 0) + 1);
      // Count locally waiting jobs too: a native port must stay open during backoff.
      this.activity();
      this.execute(item)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active.set(provider, this.active.get(provider) - 1);
          this.maintenance.delete(provider);
          if (priority === 'background') this.background = false;
          this.drain();
        });
    }
    this.activity();
  }
  wait(item, reason) {
    if (item.waitReason === reason) return;
    item.waitReason = reason;
    try {
      item.onEvent({type: 'queued', ahead: this.waiting.indexOf(item), local: true, reason});
    } catch {
      /* optional queue observer */
    }
  }
  activity() {
    this.onActivity(this.waiting.length + [...this.active.values()].reduce((a, b) => a + b, 0));
  }
  async execute(item) {
    for (let attempt = 0; ; attempt++) {
      if (item.signal?.aborted) throw cancelled();
      try {
        return await item.work();
      } catch (error) {
        if (error.code !== 'BUSY' || !['QUEUE_FULL', 'QUEUE_TIMEOUT'].includes(error.reason)) throw error;
        const retryAfter = [10000, 30000, 60000][attempt];
        item.onEvent({
          type: 'busy',
          retryAfter: item.priority === 'background' ? retryAfter : null,
          reason: error.reason
        });
        if (item.priority !== 'background' || retryAfter === undefined) throw error;
        await this.sleep(retryAfter, item.signal);
      }
    }
  }
}
