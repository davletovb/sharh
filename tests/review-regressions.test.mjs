import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSeatline} from '../src/paths/native-seatline.mjs';
import {SeatlinePath, turnFor} from '../src/paths/seatline.mjs';
import {PathError, nativeFailure, failure} from '../src/paths/errors.mjs';
import {diagnostic} from '../src/paths/diagnostics.mjs';
import {RequestPacer} from '../src/paths/pacing.mjs';
import {bytes, measureRequest, checkRequest, MAX_REQUEST_BYTES} from '../src/paths/limits.mjs';
import {PathClient} from '../extension/ui/client.mjs';
import {bindRuns} from '../extension/ui/runs.mjs';
import {SeatlinePreferences} from '../extension/lib/preferences.mjs';
import {watchPanelContext} from '../extension/ui/panel-context.mjs';
import {harness, normal, status, target, request, tick} from './helpers/seatline.mjs';
const listeners = () => {
  const items = new Set();
  return {
    addListener: (fn) => items.add(fn),
    removeListener: (fn) => items.delete(fn),
    emit: (...args) => {
      for (const fn of [...items]) fn(...args);
    }
  };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return {promise, resolve};
};

test('a failed cancellation drain preserves only its own partial text/accounting and disconnects siblings neutrally', async () => {
  const active = [];
  const h = harness(
    (frame, reply) => {
      if (frame.method === 'cancel') {
        reply({type: 'usage', usage: {input_tokens: 99, output_tokens: 7}}, frame.target);
        reply(
          {
            type: 'source',
            source: {id: 's', title: 'Final source', url: 'https://example.org', snippet: 'late'}
          },
          frame.target
        );
        reply({type: 'delta', text: 'must be ignored'}, frame.target);
      } else if (frame.method === 'send_ready_with_policy') {
        reply({type: 'status', provider: frame.provider, status: status()});
        active.push([frame, reply]);
      } else if (frame.provider !== 'gemini') normal(frame, reply);
    },
    {drainTimeout: 15}
  );
  const path = new SeatlinePath({client: h.client});
  const a = path.run(target, {...request, limits: {maxOutputBytes: 4}}),
    b = path.run({...target, provider: 'claude'}, request);
  const c = h.client.request('gemini', 'readiness', {}),
    settled = Promise.allSettled([a, b, c]);
  await tick();
  active[0][1]({type: 'delta', text: 'AAAAAA'});
  active[1][1]({type: 'delta', text: 'B-REAL-ANSWER'});
  await new Promise((r) => setTimeout(r, 35));
  const [ar, br, cr] = await settled;
  assert.equal(ar.status, 'fulfilled');
  assert.equal(ar.value.text, 'AAAA');
  assert.equal(ar.value.truncated, true);
  assert.equal(ar.value.usage.input_tokens, 99);
  assert.equal(ar.value.sources[0].title, 'Final source');
  for (const r of [br, cr]) {
    assert.equal(r.status, 'rejected');
    assert.equal(r.reason.code, 'DISCONNECTED');
    assert.equal(r.reason.partial, undefined);
  }
  assert.equal(h.sent.filter((f) => f.method === 'send_ready_with_policy').length, 2);
  h.client.close();
});

test('user cancellation, client timeout and failed cancel posting do not relabel unrelated turns', async () => {
  for (const mode of ['stop', 'timeout', 'post-failed']) {
    const h = harness(
      (frame) => {
        if (frame.method === 'cancel' && mode === 'post-failed') throw Error('closed');
      },
      {drainTimeout: 8}
    );
    const signal = new AbortController();
    const a = h.client.request(
      'codex',
      'send_ready_with_policy',
      {turn: {session: 'ephemeral'}},
      {signal: signal.signal, timeout: mode === 'timeout' ? 5 : 1000}
    );
    const b = h.client.request('claude', 'readiness', {}),
      settled = Promise.allSettled([a, b]);
    await tick();
    if (mode !== 'timeout') signal.abort();
    await new Promise((r) => setTimeout(r, 30));
    const [ar, br] = await settled;
    assert.equal(ar.reason.code, mode === 'timeout' ? 'TIMEOUT' : 'CANCELLED');
    assert.equal(br.reason.code, 'DISCONNECTED');
    assert.equal(br.reason.partial, undefined);
    h.client.close();
  }
});

test('usage and sources received after a cap reach the truncated result and its observers before stopped', async () => {
  const events = [];
  const h = harness((frame, reply) => {
    if (frame.method === 'cancel')
      queueMicrotask(() => {
        reply({type: 'usage', usage: {input_tokens: 23, output_tokens: 42}}, frame.target);
        reply(
          {type: 'source', source: {id: 's', title: 'Late', url: 'https://example.org', snippet: 'source'}},
          frame.target
        );
        reply({type: 'stopped'}, frame.target);
      });
    else if (frame.method === 'send_ready_with_policy') {
      reply({type: 'status', provider: frame.provider, status: status()});
      reply({type: 'delta', text: 'abcdef'});
    } else normal(frame, reply);
  });
  const result = await new SeatlinePath({client: h.client}).run(
    target,
    {...request, limits: {maxOutputBytes: 4}},
    {onEvent: (e) => events.push(e.type)}
  );
  assert.equal(result.text, 'abcd');
  assert.equal(result.usage.output_tokens, 42);
  assert.equal(result.sources.length, 1);
  assert.ok(events.includes('usage') && events.includes('source'));
  h.client.close();
});

test('Chrome verbatim forbidden, missing-host and early/late disconnect errors map to distinct setup states', () => {
  for (const [message, beforeReady, code, title] of [
    [
      'Access to the specified native messaging host is forbidden.',
      true,
      'NOT_AUTHORIZED',
      'Sharh not authorized'
    ],
    ['Specified native messaging host not found.', true, 'NOT_INSTALLED', 'Companion missing'],
    ['', true, 'NOT_AUTHORIZED', 'Sharh not authorized'],
    ['unrecognized disconnect', false, 'DISCONNECTED', 'Disconnected']
  ]) {
    const error = nativeFailure(message, beforeReady);
    assert.equal(error.code, code);
    assert.equal(diagnostic({error}).title, title);
  }
});

test('UI worker ports reconnect only for new calls, reject lost work once and contain abort/post errors', async () => {
  const previous = globalThis.chrome,
    ports = [];
  globalThis.chrome = {
    runtime: {
      connect() {
        const port = {
          onMessage: listeners(),
          onDisconnect: listeners(),
          sent: [],
          closed: false,
          postMessage(frame) {
            if (this.closed) throw Error('Attempting to use a disconnected port object');
            this.sent.push(frame);
            if (frame.method === 'discover')
              queueMicrotask(() => this.onMessage.emit({id: frame.id, result: 'ok'}));
          },
          disconnect() {
            if (!this.closed) {
              this.closed = true;
              this.onDisconnect.emit();
            }
          }
        };
        ports.push(port);
        return port;
      }
    }
  };
  try {
    const client = new PathClient();
    assert.equal(await client.call('discover'), 'ok');
    const signal = new AbortController(),
      lost = client.call('run', {}, {signal: signal.signal});
    const rejected = assert.rejects(lost, {code: 'DISCONNECTED'});
    ports[0].disconnect();
    await rejected;
    assert.doesNotThrow(() => signal.abort());
    assert.equal(await client.call('discover'), 'ok');
    assert.equal(ports.length, 2);
    assert.equal(ports[1].sent.filter((f) => f.method === 'run').length, 0);
    ports[1].postMessage = () => {
      throw Error('dead');
    };
    await assert.rejects(client.call('run'), (error) => error.code === 'DISCONNECTED' && !!error.hint);
    assert.equal(await client.call('discover'), 'ok');
    assert.equal(ports.length, 3);
    const cancel = new AbortController(),
      pending = client.call('run', {}, {signal: cancel.signal});
    const failure = assert.rejects(pending, {code: 'DISCONNECTED'});
    ports[2].postMessage = () => {
      throw Error('dead');
    };
    assert.doesNotThrow(() => cancel.abort());
    await failure;
  } finally {
    globalThis.chrome = previous;
  }
});

test('history metadata is projected out of immutable wire messages; malformed history and empty prompts never connect', async () => {
  const h = harness(normal),
    path = new SeatlinePath({client: h.client});
  const history = [
    {role: 'user', text: 'old', id: 'm1', createdAt: 1},
    {role: 'assistant', text: 'answer', id: 'm2'}
  ];
  await path.run(target, {...request, kind: 'chat', history});
  assert.deepEqual(
    h.sent.find((f) => f.method === 'send_ready_with_policy').params.turn.messages.slice(0, 2),
    [
      {role: 'user', text: 'old'},
      {role: 'assistant', text: 'answer'}
    ]
  );
  assert.equal(Object.isFrozen(history[0]), false);
  h.client.close();
  const bad = harness(normal),
    checked = new SeatlinePath({client: bad.client});
  for (const value of ['', 0, false, {}, [null], [42], [[]], [{role: 'user', text: null}]])
    await assert.rejects(checked.run(target, {...request, history: value}), {
      code: 'OPTION_UNSUPPORTED',
      reason: 'INVALID_HISTORY'
    });
  await assert.rejects(checked.run(target, {...request, task: ' ', document: null}), {
    reason: 'EMPTY_PROMPT'
  });
  await assert.rejects(checked.run(target, {...request, task: '\0'}), {reason: 'INVALID_REQUEST'});
  assert.equal(bad.ports.length, 0);
  bad.client.close();
});

test('readiness recovery exposes one logical terminal event, including when the second refusal is final', async () => {
  for (const failAgain of [false, true]) {
    let sends = 0;
    const seen = [];
    const h = harness((frame, reply) => {
      if (frame.method === 'send_ready_with_policy' && (sends++ === 0 || failAgain))
        reply({type: 'failed', code: 'InvalidRequest', reason: 'READINESS_CHANGED', retryable: false});
      else normal(frame, reply);
    });
    const run = new SeatlinePath({client: h.client}).run(target, request, {onEvent: (e) => seen.push(e)});
    if (failAgain) await assert.rejects(run, {reason: 'READINESS_CHANGED'});
    else await run;
    assert.equal(seen.filter((e) => ['completed', 'failed', 'stopped'].includes(e.type)).length, 1);
    assert.equal(seen.filter((e) => e.type === 'retrying').length, 1);
    h.client.close();
  }
});

test('protocol diagnostics distinguish an old companion from an old extension and tolerate ready metadata', async () => {
  for (const [frame, reason] of [
    [{type: 'ready', version: 0}, 'PROTOCOL_VERSION'],
    [{type: 'ready', version: 2}, 'EXTENSION_UPDATE_REQUIRED'],
    [{type: 'ready', version: '1'}, 'PROTOCOL_ERROR']
  ]) {
    const client = new NativeSeatline(() => ({
      onMessage: {addListener: (fn) => queueMicrotask(() => fn(frame))},
      onDisconnect: listeners(),
      disconnect() {}
    }));
    await assert.rejects(client.request('codex', 'readiness', {}), (error) => {
      assert.equal(error.reason, reason);
      if (frame.version === 2) {
        assert.equal(diagnostic({error}).title, 'Sharh too old');
        assert.match(error.hint, /Update Sharh/);
      }
      return true;
    });
    client.close();
  }
  const h = harness(normal);
  const ready = h.client.connect();
  h.ports[0].onMessage.emit({type: 'ready', version: 1, build: 'future-metadata'});
  await ready;
  h.client.close();
});

test('pending maintenance admits interactive work; active maintenance reports local waiting and drains before new work', async () => {
  const pacer = new RequestPacer(),
    background = deferred(),
    cleaning = deferred(),
    events = [];
  let maintenanceStarted = false,
    interactiveStarted = false;
  const bg = pacer.run('codex', 'background', () => background.promise);
  const cleanup = pacer.maintain('codex', () => {
    maintenanceStarted = true;
    return cleaning.promise;
  });
  await pacer.run('codex', 'interactive', async () => {
    interactiveStarted = true;
  });
  assert.equal(interactiveStarted, true);
  assert.equal(maintenanceStarted, false);
  background.resolve();
  await bg;
  await tick();
  assert.equal(maintenanceStarted, true);
  let after = false;
  const waiting = pacer.run(
    'codex',
    'interactive',
    async () => {
      after = true;
    },
    {onEvent: (e) => events.push(e)}
  );
  assert.equal(after, false);
  assert.ok(events.some((e) => e.type === 'queued' && e.local && e.reason === 'maintenance'));
  cleaning.resolve();
  await cleanup;
  await waiting;
  assert.equal(after, true);
});

test('preparation is reused when fresh, expiry or disconnect forces readiness, and background abort never waits for warmup', async () => {
  let now = 0;
  const h = harness(normal),
    path = new SeatlinePath({client: h.client, now: () => now});
  await path.prepareFor('job-start', target);
  await path.run(target, {...request, priority: 'background'});
  assert.deepEqual(
    h.sent.map((f) => f.method),
    ['prepare', 'send_ready_with_policy']
  );
  now = 30001;
  await path.run(target, request);
  assert.equal(h.sent.at(-2).method, 'readiness');
  const aborted = new AbortController();
  aborted.abort();
  const count = h.sent.length;
  await assert.rejects(path.run(target, {...request, priority: 'background'}, {signal: aborted.signal}), {
    code: 'CANCELLED'
  });
  assert.equal(h.sent.length, count);
  h.client.close();
  const held = harness((frame, reply) => {
    if (frame.method !== 'prepare') normal(frame, reply);
  });
  const independent = new SeatlinePath({client: held.client});
  const warmAbort = new AbortController();
  const warm = independent.prepare(target, {signal: warmAbort.signal});
  await tick();
  const runAbort = new AbortController();
  const run = independent.run(target, {...request, priority: 'background'}, {signal: runAbort.signal});
  runAbort.abort();
  await assert.rejects(run, {code: 'CANCELLED'});
  held.client.close();
  await warm;
});

test('policy refresh cannot be overwritten by late startup reads, late old reads or delayed storage notifications', async () => {
  const reads = [],
    onChanged = listeners(),
    storage = {
      onChanged,
      local: {
        get: () => {
          const item = deferred();
          reads.push(item);
          return item.promise;
        }
      }
    };
  const prefs = new SeatlinePreferences(storage),
    old = prefs.refresh();
  onChanged.emit({seatlinePolicy: {newValue: {allowGeminiCloud: true}}}, 'local');
  reads[0].resolve({seatlinePolicy: {allowGeminiCloud: false}});
  await old;
  assert.equal(prefs.value.allowGeminiCloud, true);
  const first = prefs.refresh(),
    second = prefs.refresh();
  reads[2].resolve({seatlinePolicy: {allowGeminiCloud: true}});
  await second;
  reads[1].resolve({seatlinePolicy: {allowGeminiCloud: false}});
  await first;
  assert.equal(prefs.value.allowGeminiCloud, true);
  const latest = prefs.refresh();
  reads[3].resolve({seatlinePolicy: {allowGeminiCloud: false}});
  await latest;
  assert.equal(prefs.value.allowGeminiCloud, false);
});

test('panel warmup handles hidden URLs, tab changes and the selected provider without additional permissions', async () => {
  const onActivated = listeners(),
    onUpdated = listeners(),
    onChanged = listeners(),
    calls = [];
  let current = {id: 1},
    selected = {path: 'seatline', provider: 'codex'};
  const stop = watchPanelContext(
    {call: async (method, params) => calls.push({method, ...params})},
    {
      tabs: {query: async () => [current], onActivated, onUpdated},
      storage: {onChanged, local: {get: async () => ({seatlineTarget: selected})}}
    }
  );
  await tick();
  assert.equal(calls[0].target.provider, 'codex');
  current = {id: 2};
  onActivated.emit({tabId: 2});
  await tick();
  assert.equal(calls.length, 2);
  selected = {path: 'seatline', provider: 'gemini'};
  onChanged.emit({seatlineTarget: {newValue: selected}}, 'local');
  await tick();
  assert.equal(calls.at(-1).target.provider, 'gemini');
  onUpdated.emit(2, {status: 'complete'});
  await tick();
  assert.equal(calls.length, 4);
  current = {id: 3, url: 'chrome://settings'};
  onActivated.emit({tabId: 3});
  await tick();
  assert.equal(calls.length, 4);
  stop();
  onActivated.emit({tabId: 4});
  await tick();
  assert.equal(calls.length, 4);
});

const element = () => {
  const handlers = new Map();
  return {
    textContent: '',
    hidden: false,
    addEventListener: (name, fn) => handlers.set(name, fn),
    click: () => handlers.get('click')?.()
  };
};
test('session-capacity refusal gives actionable text without a futile Retry button; queue-busy can retry', async () => {
  assert.match(
    failure(
      {code: 'InvalidRequest', reason: 'SESSION_LIMIT_REACHED', retryable: false},
      'send_ready_with_policy'
    ).hint,
    /session limit/
  );
  for (const reason of ['SESSION_LIMIT_REACHED', 'QUEUE_FULL', 'QUEUE_TIMEOUT']) {
    const state = element(),
      retry = element(),
      stop = element(),
      error = new PathError('BUSY', reason, reason !== 'SESSION_LIMIT_REACHED');
    const view = bindRuns(
      {
        call: async () => {
          throw error;
        }
      },
      {state, retry, stop}
    );
    await assert.rejects(view.run({}, {}));
    assert.equal(retry.hidden, reason === 'SESSION_LIMIT_REACHED');
  }
});

test('shared request sizing matches actual UTF-8 wire bytes for cached immutable turns and refuses the boundary', () => {
  const history = [{role: 'user', text: 'старое 🧭', extra: 'removed'}],
    turn = turnFor(target, {...request, document: 'عربي я 🧭', history});
  const frame = {
    id: '0'.repeat(36),
    provider: 'codex',
    method: 'send_ready_with_policy',
    params: {turn, freshness: {mode: 'cached', max_age_ms: 30000}, allowed_sign_in: ['subscription']},
    scheduling: {interactive: true, events: true}
  };
  assert.equal(measureRequest(frame), bytes(JSON.stringify(frame)));
  assert.equal(
    measureRequest({...frame, params: {...frame.params, allowed_sign_in: []}}),
    bytes(JSON.stringify({...frame, params: {...frame.params, allowed_sign_in: []}}))
  );
  assert.equal(Object.isFrozen(turn.messages[0]), true);
  assert.equal(Object.isFrozen(history[0]), false);
  const raw = {id: 'x', provider: 'codex', method: 'status', params: {text: ''}},
    overhead = bytes(JSON.stringify(raw));
  raw.params.text = 'a'.repeat(MAX_REQUEST_BYTES - overhead);
  assert.doesNotThrow(() => checkRequest(raw));
  raw.params.text += 'a';
  assert.throws(() => checkRequest(raw), {code: 'TOO_LARGE'});
});
