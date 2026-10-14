// Adapted from Lineleaf NativeSeatline at c6403c5; streaming/persistent/pacing extensions are Sharh's.
import contract from '../../config/seatline-contract.json' with {type: 'json'};
import {PathError, cancelled, failure, nativeFailure} from './errors.mjs';
const TERMINAL = new Set(['completed', 'failed', 'stopped']);
const REPORTS = new Set(['status', 'readiness', 'prepare']);
const UNSENT = Symbol('unsent');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const bytes = (value) => new TextEncoder().encode(value).length;
export const OUTPUT_CAPS = Object.freeze({
  quick: 32768,
  repair: 32768,
  analysis: 262144,
  chat: 262144,
  search: 262144,
  synthesis: 524288
});
const timer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return t;
};
function untilReady(ready, signal) {
  if (!signal) return ready;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, {once: true});
    ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function validStatus(status) {
  return (
    object(status) &&
    ['available', 'unavailable', 'not_found', 'unknown'].includes(status.availability) &&
    ['authenticated', 'unauthenticated', 'unknown'].includes(status.authentication) &&
    (status.sign_in == null || ['subscription', 'api_key', 'cloud', 'unknown'].includes(status.sign_in)) &&
    object(status.capabilities) &&
    Object.values(status.capabilities).every((v) => v === true || v === false || v === 'unknown') &&
    Array.isArray(status.models) &&
    status.models.every((m) => object(m) && typeof m.id === 'string' && typeof m.label === 'string')
  );
}
export class NativeSeatline {
  constructor(
    connectNative,
    {
      readyTimeout = 5000,
      drainTimeout = 2500,
      idleTimeout = 60000,
      disconnectMessage = () => '',
      onClose = () => {}
    } = {}
  ) {
    Object.assign(this, {connectNative, readyTimeout, drainTimeout, idleTimeout, disconnectMessage, onClose});
    this.pending = new Map();
    this.port = null;
    this.ready = null;
    this.retired = new Set();
    this.jobs = 0;
  }
  setJobsActive(count) {
    this.jobs = count;
    this.scheduleIdle();
  }
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.port && !this.pending.size && !this.jobs)
      this.idleTimer = timer(() => this.close(), this.idleTimeout);
  }
  connect() {
    if (this.ready) return this.ready;
    const ready = (this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    }));
    this.readyTimer = timer(
      () => this.close(new PathError('NOT_AUTHORIZED', 'READY_TIMEOUT')),
      this.readyTimeout
    );
    try {
      const port = (this.port = this.connectNative(contract.native_host));
      port.onMessage.addListener((frame) => {
        if (this.port === port) this.receive(frame);
      });
      port.onDisconnect.addListener(() => {
        if (this.port === port) this.close(nativeFailure(this.disconnectMessage(port), !!this.readyResolve));
      });
    } catch (error) {
      this.close(nativeFailure(error.message, true));
    }
    return ready;
  }
  async request(provider, method, params = null, options = {}) {
    if (
      !contract.providers.includes(provider) ||
      !['status', 'readiness', 'prepare', 'send_ready_with_policy', 'forget', 'cleanup'].includes(method)
    )
      throw new PathError('PROVIDER_FAILED', 'INVALID_REQUEST');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(provider, method, params, options);
      } catch (error) {
        if (!error[UNSENT] || attempt) throw error;
      }
    }
  }
  async attempt(
    provider,
    method,
    params,
    {
      signal,
      onEvent = () => {},
      onStatus = null,
      kind = 'analysis',
      maxOutputBytes = OUTPUT_CAPS[kind],
      scheduling,
      // Include the broker's queue allowance before its provider execution deadline.
      timeout = contract.limits.queue_timeout_ms +
        (REPORTS.has(method) ? 30000 : contract.limits.max_turn_seconds * 1000) +
        5000
    } = {}
  ) {
    if (signal?.aborted) throw cancelled();
    if (
      !Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes < 1 ||
      maxOutputBytes > (OUTPUT_CAPS[kind] || OUTPUT_CAPS.analysis)
    )
      throw new PathError('TOO_LARGE', 'INVALID_OUTPUT_LIMIT');
    const id = crypto.randomUUID(),
      frame = {id, provider, method, params, ...(scheduling ? {scheduling} : {})};
    if (bytes(JSON.stringify(frame)) > contract.reading_policy.max_request_bytes)
      throw new PathError('TOO_LARGE', 'REQUEST_TOO_LARGE');
    await untilReady(this.connect(), signal);
    if (signal?.aborted) throw cancelled();
    if (!this.port) throw Object.assign(new PathError('DISCONNECTED'), {[UNSENT]: true});
    clearTimeout(this.idleTimer);
    return new Promise((resolve, reject) => {
      const item = {
        id,
        provider,
        method,
        resolve,
        reject,
        signal,
        onEvent,
        onStatus,
        maxOutputBytes,
        persistent: params?.turn?.session === 'persistent',
        text: '',
        sources: [],
        usage: null,
        session: null,
        status: null,
        bytes: 0
      };
      item.abort = () => this.cancel(id, cancelled());
      item.timer = timer(() => this.cancel(id, new PathError('TIMEOUT', 'CLIENT_TIMEOUT', true)), timeout);
      this.pending.set(id, item);
      signal?.addEventListener('abort', item.abort, {once: true});
      try {
        this.port.postMessage(frame);
      } catch {
        // A postMessage exception is ambiguous. Never replay it or any request already posted.
        this.close(new PathError('DISCONNECTED', 'POST_FAILED', true));
      }
    });
  }
  receive(frame) {
    try {
      if (!object(frame) || bytes(JSON.stringify(frame)) > contract.frame.max_bytes) throw Error();
      if (this.readyResolve) {
        if (
          Object.keys(frame).sort().join() !== 'type,version' ||
          frame.type !== 'ready' ||
          frame.version !== contract.protocol
        ) {
          return this.close(new PathError('UPDATE_REQUIRED', 'PROTOCOL_VERSION'));
        }
        clearTimeout(this.readyTimer);
        const resolve = this.readyResolve;
        this.readyResolve = this.readyReject = null;
        resolve();
        this.scheduleIdle();
        return;
      }
      if (
        Object.keys(frame).sort().join() !== 'event,id' ||
        typeof frame.id !== 'string' ||
        !object(frame.event) ||
        !contract.events.includes(frame.event.type)
      )
        throw Error();
      if (this.retired.has(frame.id)) return;
      const item = this.pending.get(frame.id),
        event = frame.event;
      if (!item) throw Error();
      if (item.cancellation) {
        if (TERMINAL.has(event.type)) this.finish(item, item.cancellation);
        return;
      }
      const generating = item.method === 'send_ready_with_policy';
      switch (event.type) {
        case 'delta':
          if (
            !generating ||
            typeof event.text !== 'string' ||
            !event.text.isWellFormed() ||
            bytes(event.text) > 16384
          )
            throw Error();
          if (item.bytes + bytes(event.text) > item.maxOutputBytes) {
            // Keep a whole-code-point prefix of the final chunk without crossing the UTF-8 cap.
            let prefix = '';
            for (const point of event.text) {
              const size = bytes(point);
              if (item.bytes + size > item.maxOutputBytes) break;
              item.bytes += size;
              prefix += point;
            }
            item.text += prefix;
            if (prefix) this.emit(item, {...event, text: prefix});
            this.cancel(
              item.id,
              new PathError('TOO_LARGE', 'OUTPUT_CAP_EXCEEDED', false, {
                truncated: true,
                partial: this.result(item)
              })
            );
            return;
          }
          item.bytes += bytes(event.text);
          item.text += event.text;
          break;
        case 'status':
          if (
            (!REPORTS.has(item.method) && !generating) ||
            event.provider !== item.provider ||
            !validStatus(event.status) ||
            item.status ||
            item.bytes
          )
            throw Error();
          item.status = event.status;
          if (item.onStatus) {
            try {
              item.onStatus(event.status);
            } catch (error) {
              this.cancel(item.id, error);
              return;
            }
          }
          break;
        case 'session':
          if (
            !item.persistent ||
            typeof event.handle !== 'string' ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(event.handle)
          )
            throw Error();
          item.session = event.handle;
          break;
        case 'session_lost':
          if (!item.persistent || typeof event.confirmed !== 'boolean') throw Error();
          item.session = null;
          break;
        case 'source':
          if (
            !generating ||
            !object(event.source) ||
            item.sources.length >= 20 ||
            !['id', 'title', 'url', 'snippet'].every((key) => typeof event.source[key] === 'string')
          )
            throw Error();
          item.sources.push(event.source);
          break;
        case 'usage':
          if (
            !generating ||
            !object(event.usage) ||
            ![
              'input_tokens',
              'output_tokens',
              'cached_input_tokens',
              'cache_write_input_tokens',
              'reasoning_output_tokens'
            ].every(
              (key) =>
                event.usage[key] == null || (Number.isSafeInteger(event.usage[key]) && event.usage[key] >= 0)
            )
          )
            throw Error();
          item.usage = event.usage;
          break;
        case 'queued':
          if (!Number.isSafeInteger(event.ahead) || event.ahead < 0) throw Error();
          break;
        case 'failed':
          if (
            typeof event.code !== 'string' ||
            typeof event.reason !== 'string' ||
            typeof event.retryable !== 'boolean'
          )
            throw Error();
          this.emit(item, event);
          this.finish(item, item.cancellation || failure(event, item.method));
          return;
        case 'stopped':
          this.emit(item, event);
          this.finish(item, item.cancellation || cancelled());
          return;
        case 'completed':
          if ((REPORTS.has(item.method) || generating) && !item.status) throw Error();
          this.emit(item, event);
          this.finish(item, item.cancellation);
          return;
      }
      this.emit(item, event);
    } catch {
      this.close(new PathError('PROVIDER_FAILED', 'PROTOCOL_ERROR'));
    }
  }
  emit(item, event) {
    try {
      item.onEvent(event);
    } catch {
      const error = new PathError('PROVIDER_FAILED', 'CALLBACK_FAILED');
      // A terminal event already ended the provider turn; finish locally without a redundant cancel.
      if (TERMINAL.has(event.type)) item.cancellation = error;
      else this.cancel(item.id, error);
    }
  }
  result(item) {
    return {
      text: item.text,
      sources: item.sources,
      usage: item.usage,
      session: item.session,
      status: item.status
    };
  }
  cancel(id, error) {
    const item = this.pending.get(id);
    if (!item || item.cancellation) return;
    item.cancellation = error;
    clearTimeout(item.timer);
    item.timer = timer(() => this.close(error), this.drainTimeout);
    try {
      this.port.postMessage({id: crypto.randomUUID(), method: 'cancel', target: id});
    } catch {
      this.close(error);
    }
  }
  finish(item, error) {
    if (this.pending.get(item.id) !== item) return;
    clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    this.pending.delete(item.id);
    this.retired.add(item.id);
    if (this.retired.size > 256) this.retired.delete(this.retired.values().next().value);
    error ? item.reject(error) : item.resolve(this.result(item));
    this.scheduleIdle();
  }
  close(error = new PathError('DISCONNECTED', 'IDLE_CLOSED', true)) {
    const port = this.port;
    this.port = null;
    clearTimeout(this.readyTimer);
    clearTimeout(this.idleTimer);
    this.readyReject?.(error);
    this.readyResolve = this.readyReject = null;
    this.ready = null;
    for (const item of this.pending.values()) this.finish(item, item.cancellation || error);
    this.retired.clear();
    try {
      port?.disconnect();
    } catch {
      /* already gone */
    }
    this.onClose(error);
  }
}
