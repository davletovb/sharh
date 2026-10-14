import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSeatline, OUTPUT_CAPS} from '../src/paths/native-seatline.mjs';
import {harness, normal, status, tick} from './helpers/seatline.mjs';
const params = {turn: {session: 'ephemeral'}};
test('native streaming forwards source, usage, queue and admission with scheduling hints', async () => {
  const h = harness((frame, reply) => {
    reply({type: 'queued', ahead: 2, timeout_ms: 30000});
    reply({type: 'admitted'});
    reply({type: 'status', provider: 'codex', status: status()});
    reply({type: 'delta', text: 'first '});
    reply({type: 'delta', text: 'second'});
    reply({
      type: 'source',
      source: {id: 's1', title: 'Source', url: 'https://example.org', snippet: 'snippet'}
    });
    reply({type: 'usage', usage: {input_tokens: 10, output_tokens: 3}});
    reply({type: 'completed'});
  });
  const events = [];
  const result = await h.client.request('codex', 'send_ready_with_policy', params, {
    scheduling: {interactive: true, events: true},
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.text, 'first second');
  assert.deepEqual(
    events.filter((e) => e.type === 'delta').map((e) => e.text),
    ['first ', 'second']
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.usage.output_tokens, 3);
  assert.deepEqual(
    events.map((e) => e.type),
    ['queued', 'admitted', 'status', 'delta', 'delta', 'source', 'usage', 'completed']
  );
  assert.deepEqual(h.sent[0].scheduling, {interactive: true, events: true});
  h.client.close();
});
test('per-kind UTF-8 caps cancel only the target, retain partial text, and drain before reuse', async () => {
  assert.deepEqual([OUTPUT_CAPS.quick, OUTPUT_CAPS.analysis, OUTPUT_CAPS.synthesis], [32768, 262144, 524288]);
  const h = harness((frame, reply) => {
    if (frame.method === 'cancel') reply({type: 'stopped'}, frame.target);
  });
  const capped = h.client.request('codex', 'send_ready_with_policy', params, {
    kind: 'quick',
    maxOutputBytes: 4
  });
  const other = h.client.request('claude', 'readiness', {});
  await tick();
  const [run, read] = h.sent;
  h.reply(run, {type: 'status', provider: 'codex', status: status()});
  h.reply(run, {type: 'delta', text: 'я'});
  h.reply(run, {type: 'delta', text: 'яя'});
  await assert.rejects(
    capped,
    (error) => error.reason === 'OUTPUT_CAP_EXCEEDED' && error.partial.text === 'яя' && error.truncated
  );
  assert.deepEqual(Object.keys(h.sent.at(-1)).sort(), ['id', 'method', 'target']);
  assert.equal(h.sent.at(-1).target, run.id);
  h.reply(run, {type: 'delta', text: 'late'});
  h.reply(read, {type: 'status', provider: 'claude', status: status()});
  h.reply(read, {type: 'completed'});
  await other;
  h.client.close();
});
test('persistent requests accept session and session_lost; ephemeral requests reject them', async () => {
  for (const type of ['session', 'session_lost']) {
    const event = type === 'session' ? {type, handle: 'broker_token'} : {type, confirmed: true};
    const h = harness((frame, reply) => {
      reply({type: 'status', provider: 'codex', status: status()});
      reply(event);
      reply({type: 'completed'});
    });
    const seen = [];
    const result = await h.client.request(
      'codex',
      'send_ready_with_policy',
      {turn: {session: 'persistent'}},
      {onEvent: (e) => seen.push(e)}
    );
    assert.ok(seen.some((e) => e.type === type));
    assert.equal(result.session, type === 'session' ? 'broker_token' : null);
    h.client.close();
    const bad = harness((frame, reply) => reply(event));
    await assert.rejects(bad.client.request('codex', 'send_ready_with_policy', params), {
      reason: 'PROTOCOL_ERROR'
    });
    bad.client.close();
  }
});
test('abort while ready is shared does not disconnect another requester', async () => {
  const h = harness();
  const abort = new AbortController();
  const a = h.client.request('codex', 'readiness', {}, {signal: abort.signal});
  const b = h.client.request('claude', 'readiness', {});
  abort.abort();
  await assert.rejects(a, {code: 'CANCELLED'});
  await tick();
  assert.equal(h.ports.length, 1);
  normal(h.sent[0], (event) => h.reply(h.sent[0], event));
  await b;
  h.client.close();
});
test('cancel and disconnect never replay sent requests; later work reconnects', async () => {
  const h = harness((frame, reply) => {
    if (frame.method === 'cancel') reply({type: 'stopped'}, frame.target);
  });
  const abort = new AbortController(),
    run = h.client.request('codex', 'send_ready_with_policy', params, {signal: abort.signal});
  await tick();
  abort.abort();
  await assert.rejects(run, {code: 'CANCELLED'});
  const lost = h.client.request('codex', 'readiness', {});
  await tick();
  h.ports[0].disconnect();
  await assert.rejects(lost, {code: 'DISCONNECTED'});
  assert.equal(h.ports.length, 1);
  const next = h.client.request('codex', 'readiness', {});
  await tick();
  normal(h.sent.at(-1), (e) => h.reply(h.sent.at(-1), e));
  await next;
  assert.equal(h.ports.length, 2);
  h.client.close();
});
test('a connection lost after ready but before posting is retried once; post exceptions are ambiguous', async () => {
  let connects = 0,
    posts = 0;
  const client = new NativeSeatline(() => {
    const port = {
      onMessage: {
        addListener(fn) {
          queueMicrotask(() => {
            fn({type: 'ready', version: 1});
            if (connects === 1) port.disconnect();
          });
        }
      },
      onDisconnect: {
        addListener(fn) {
          port.closed = fn;
        }
      },
      postMessage(frame) {
        posts++;
        queueMicrotask(() =>
          client.receive({id: frame.id, event: {type: 'status', provider: 'codex', status: status()}})
        );
        queueMicrotask(() => client.receive({id: frame.id, event: {type: 'completed'}}));
      },
      disconnect() {
        port.closed?.();
      }
    };
    connects++;
    return port;
  });
  await client.request('codex', 'readiness', {});
  assert.equal(connects, 2);
  assert.equal(posts, 1);
  client.close();
  const h = harness(() => {
    throw Error('closed?');
  });
  await assert.rejects(h.client.request('codex', 'readiness', {}), {reason: 'POST_FAILED'});
  assert.equal(h.sent.length, 1);
  assert.equal(h.ports.length, 1);
  h.client.close();
});
test('oversized requests never connect; malformed frames and unrecognized IDs close all in flight', async () => {
  const h = harness();
  await assert.rejects(h.client.request('codex', 'send_ready_with_policy', {text: 'я'.repeat(500001)}), {
    code: 'TOO_LARGE'
  });
  assert.equal(h.ports.length, 0);
  for (const event of [
    {type: 'delta', text: 42},
    {type: 'delta', text: 'x'.repeat(16385)},
    {type: 'session', handle: 'not persistent'},
    {type: 'usage', usage: {input_tokens: -1, output_tokens: 2}},
    {type: 'source', source: {}},
    {type: 'queued', ahead: -1},
    {type: 'new_event'}
  ]) {
    const bad = harness((frame, reply) => reply(event));
    await assert.rejects(bad.client.request('codex', 'send_ready_with_policy', params), {
      reason: 'PROTOCOL_ERROR'
    });
    bad.client.close();
  }
  const unknown = h.client.request('codex', 'readiness', {});
  await tick();
  h.ports[0].onMessage.emit({id: 'unknown', event: {type: 'completed'}});
  await assert.rejects(unknown, {reason: 'PROTOCOL_ERROR'});
  h.client.close();
});
test('idle closes at the configured deadline and an active job holds the port', async () => {
  const h = harness(normal, {idleTimeout: 12});
  await h.client.request('codex', 'readiness', {});
  h.client.setJobsActive(1);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.ports[0].closed, false);
  h.client.setJobsActive(0);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.ports[0].closed, true);
  h.client.close();
});

test('capped final chunks preserve whole Unicode characters and partial counters', async () => {
  const h = harness((frame, reply) => {
    if (frame.method === 'cancel') return reply({type: 'stopped'}, frame.target);
    reply({type: 'status', provider: 'codex', status: status()});
    reply({type: 'delta', text: 'я🧭z'});
  });
  const seen = [];
  await assert.rejects(
    h.client.request('codex', 'send_ready_with_policy', params, {
      maxOutputBytes: 5,
      onEvent: (e) => {
        if (e.type === 'delta') seen.push(e.text);
      }
    }),
    (error) => error.reason === 'OUTPUT_CAP_EXCEEDED' && error.partial.text === 'я'
  );
  assert.deepEqual(seen, ['я']);
  h.client.close();
});

test('native setup failures distinguish missing and forbidden hosts without posting', async () => {
  for (const [message, code] of [
    ['Specified native messaging host not found.', 'NOT_INSTALLED'],
    ['Access to native messaging host is forbidden.', 'NOT_AUTHORIZED']
  ]) {
    let connects = 0;
    const client = new NativeSeatline(() => {
      connects++;
      throw Error(message);
    });
    await assert.rejects(client.request('codex', 'readiness', {}), {code});
    assert.equal(connects, 1);
    client.close();
  }
});
