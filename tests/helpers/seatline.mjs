import {NativeSeatline} from '../../src/paths/native-seatline.mjs';
export const status = (overrides = {}) => ({
  availability: 'available',
  authentication: 'authenticated',
  sign_in: 'subscription',
  models: [],
  capabilities: {
    streaming: true,
    continuation: true,
    web_search: true,
    reasoning_effort: true,
    service_tier: true,
    tool_isolation: true
  },
  ...overrides
});
const listeners = () => {
  const list = new Set();
  return {
    addListener: (fn) => list.add(fn),
    emit: (value) => {
      for (const fn of list) fn(value);
    }
  };
};
export const tick = () => new Promise((resolve) => setImmediate(resolve));
export function harness(handler, options = {}) {
  const ports = [],
    sent = [];
  const connect = () => {
    const port = {
      onMessage: listeners(),
      onDisconnect: listeners(),
      closed: false,
      postMessage(frame) {
        sent.push(frame);
        handler?.(frame, (event, id = frame.id) => port.onMessage.emit({id, event}), port);
      },
      disconnect() {
        if (!port.closed) {
          port.closed = true;
          port.onDisconnect.emit();
        }
      }
    };
    ports.push(port);
    queueMicrotask(() => port.onMessage.emit({type: 'ready', version: 1}));
    return port;
  };
  const client = new NativeSeatline(connect, options);
  return {client, ports, sent, reply: (frame, event) => ports.at(-1).onMessage.emit({id: frame.id, event})};
}
export function normal(frame, reply) {
  if (frame.method === 'cancel') {
    reply({type: 'stopped'}, frame.target);
    return;
  }
  if (['readiness', 'prepare', 'send_ready_with_policy', 'status'].includes(frame.method))
    reply({
      type: 'status',
      provider: frame.provider,
      status: status(frame.provider === 'gemini' ? {sign_in: 'cloud'} : {})
    });
  if (frame.method === 'send_ready_with_policy') {
    reply({type: 'started'});
    reply({type: 'delta', text: 'answer'});
  }
  reply({type: 'completed'});
}
export const target = {path: 'seatline', provider: 'codex', model: null};
export const request = {
  kind: 'analysis',
  rules: 'Rules',
  document: 'Document',
  task: 'Task',
  history: [],
  session: {mode: 'none'},
  priority: 'interactive',
  cleanupGroup: 'doc-0123456789abcdef'
};
