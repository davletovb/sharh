// Foundation probe only. The production path/client is tracked separately in B-02/B-03.
export function probeClient(port, {protocol = 1, timeoutMs = 30000, cancellationTimeoutMs = 2000, maxFrameBytes = 1000000} = {}) {
  let sequence = 0, closed = false, readyResolve, readyReject;
  const pending = new Map(), retired = new Set();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const readyTimer = setTimeout(() => close(new Error('READY_TIMEOUT')), timeoutMs);
  function close(error = new Error('DISCONNECTED')) {
    if (closed) return;
    closed = true; clearTimeout(readyTimer); readyReject(error);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear(); port.disconnect();
  }
  function cancel(id, error) {
    const request = pending.get(id); if (!request || request.error) return;
    request.error = error; clearTimeout(request.timer);
    // Drain this target's terminal event before admitting the next probe turn.
    request.timer = setTimeout(() => close(new Error('CANCEL_TIMEOUT')), cancellationTimeoutMs);
    try { port.postMessage({id: `probe-${++sequence}`, method: 'cancel', target: id}); }
    catch (sendError) { close(sendError); }
  }
  port.onDisconnect.addListener(() => close(new Error(port.errorMessage?.() || 'DISCONNECTED')));
  port.onMessage.addListener(frame => {
    if (closed) return;
    if (frame?.type === 'ready') {
      if (frame.version !== protocol) return close(new Error('PROTOCOL_VERSION_MISMATCH'));
      clearTimeout(readyTimer); readyResolve(frame); return;
    }
    if (retired.has(frame?.id)) return; // Late frames from a drained request do not poison a later run.
    const request = pending.get(frame?.id);
    if (!request || !frame.event || typeof frame.event.type !== 'string') return close(new Error('INVALID_NATIVE_FRAME'));
    const event = frame.event;
    if (!request.error) try { request.onEvent?.(event); } catch (error) { cancel(frame.id, error); }
    if (['completed', 'stopped', 'failed'].includes(event.type)) {
      clearTimeout(request.timer); pending.delete(frame.id); retired.add(frame.id);
      if (retired.size > 256) retired.delete(retired.values().next().value);
      if (request.error) request.reject(request.error);
      else if (event.type === 'completed') request.resolve(event);
      else request.reject(Object.assign(new Error(event.reason || event.type.toUpperCase()), {reason: event.reason, retryable: event.retryable}));
    }
  });
  return {ready, close,
    async request(provider, method, params = {}, onEvent) {
      await ready;
      if (closed) throw new Error('DISCONNECTED');
      const id = `probe-${++sequence}`, frame = {id, provider, method, params, scheduling: {interactive: true, events: true}};
      if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > maxFrameBytes) throw new Error('REQUEST_TOO_LARGE');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => cancel(id, new Error('REQUEST_TIMEOUT')), timeoutMs);
        pending.set(id, {resolve, reject, timer, onEvent});
        try { port.postMessage(frame); } catch (error) { close(error); }
      });
    }
  };
}
export async function probeStatuses(client, providers) {
  const results = [];
  await client.ready;
  for (const provider of providers) {
    let status = null;
    try {
      await client.request(provider, 'readiness', {mode: 'fresh'}, event => { if (event.type === 'status') status = event.status; });
      if (!status) throw new Error('NO_PROVIDER_STATUS');
      results.push({provider, status});
    } catch (error) { results.push({provider, failure: error.reason || error.message}); }
  }
  return results;
}
