import test from 'node:test';
import assert from 'node:assert/strict';
import {SeatlinePath, providerInfo, turnFor} from '../src/paths/seatline.mjs';
import {PathError, failure} from '../src/paths/errors.mjs';
import {diagnostic, authorizeCommand, runState} from '../src/paths/diagnostics.mjs';
import {RequestPacer} from '../src/paths/pacing.mjs';
import {harness, normal, status, target, request, tick} from './helpers/seatline.mjs';
test('path conformance: discover, prepare, streamed run, forget and cleanup use the pinned wire contract', async () => {
  const h = harness(normal),
    path = new SeatlinePath({client: h.client}),
    events = [];
  const providers = await path.discover();
  assert.equal(providers.length, 4);
  assert.equal(providers.find((p) => p.provider === 'gemini').accepted, false);
  await path.prepare(target);
  const result = await path.run(target, request, {onEvent: (e) => events.push(e.type)});
  assert.equal(result.text, 'answer');
  assert.deepEqual(result.target, target);
  assert.ok(events.includes('delta'));
  const send = h.sent.find((f) => f.method === 'send_ready_with_policy');
  assert.deepEqual(send.params.allowed_sign_in, ['subscription']);
  assert.equal(send.params.turn.check_sign_in, false);
  assert.equal(send.params.turn.tools, 'none');
  assert.equal(send.params.turn.session, 'ephemeral');
  await path.forget(target, ['one', 'two']);
  await path.cleanup(target, request.cleanupGroup);
  assert.ok(h.sent.some((f) => f.method === 'forget' && f.params.sessions.length === 2));
  assert.ok(h.sent.some((f) => f.method === 'cleanup' && f.params.group === request.cleanupGroup));
  assert.ok(h.sent.every((f) => f.method !== 'send'));
  h.client.close();
});
test('unknown capabilities are absent, sessions are limited to Claude/Codex and model suggestions stay optional', () => {
  const unknown = providerInfo(
    'codex',
    status({capabilities: {continuation: 'unknown', tool_isolation: 'unknown'}})
  );
  assert.equal(unknown.capabilities.sessions, false);
  assert.equal(unknown.capabilities.toolIsolation, false);
  assert.deepEqual(unknown.capabilities.effort, []);
  assert.equal(providerInfo('gemini', status()).capabilities.sessions, false);
  assert.equal(providerInfo('grok', status()).capabilities.webSearch, false);
  assert.deepEqual(providerInfo('claude', status()).capabilities.effort, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  ]);
  assert.deepEqual(providerInfo('codex', status()).capabilities.serviceTier, ['standard', 'fast']);
});
test('prepare triggers throttle per provider for ten seconds, remain quiet, and discovery invalidates on disconnect', async () => {
  let now = 100;
  const h = harness(normal),
    path = new SeatlinePath({client: h.client, now: () => now});
  for (const trigger of ['panel-document', 'passage-toolbar', 'model-picker', 'job-start'])
    await path.prepareFor(trigger, target);
  assert.equal(h.sent.length, 1);
  now += 9999;
  await path.prepare(target);
  assert.equal(h.sent.length, 1);
  now++;
  await path.prepare(target);
  assert.equal(h.sent.length, 2);
  await path.prepare({...target, provider: 'claude'});
  assert.equal(h.sent.length, 3);
  await path.prepareFor('unknown', target);
  assert.equal(h.sent.length, 3);
  await path.discover();
  const count = h.sent.length;
  await path.discover();
  assert.equal(h.sent.length, count);
  h.ports[0].disconnect();
  await path.discover();
  assert.equal(h.sent.length, count + 4);
  h.client.close();
  const failed = harness((f, r) =>
    r({type: 'failed', code: 'ProviderFailed', reason: 'PROVIDER_FAILED', retryable: true})
  );
  await new SeatlinePath({client: failed.client}).prepare(target);
  failed.client.close();
});
test('every generation checks readiness; readiness refusals retry exactly once fresh and old companions never fall back', async () => {
  for (const reason of ['READINESS_CHANGED', 'READINESS_EXPIRED', 'READINESS_UNVERIFIED']) {
    let sends = 0;
    const h = harness((frame, reply) => {
      if (frame.method === 'send_ready_with_policy' && sends++ === 0)
        reply({type: 'failed', code: 'InvalidRequest', reason, retryable: false});
      else normal(frame, reply);
    });
    await new SeatlinePath({client: h.client}).run(target, request);
    assert.equal(sends, 2);
    assert.deepEqual(
      h.sent.filter((f) => f.method === 'readiness').map((f) => f.params.mode),
      ['cached', 'fresh']
    );
    h.client.close();
    const bad = harness((f, r) =>
      f.method === 'send_ready_with_policy'
        ? r({type: 'failed', code: 'InvalidRequest', reason, retryable: true})
        : normal(f, r)
    );
    await assert.rejects(new SeatlinePath({client: bad.client}).run(target, request), {reason});
    assert.equal(bad.sent.filter((f) => f.method === 'send_ready_with_policy').length, 2);
    bad.client.close();
  }
  for (const method of ['readiness', 'send_ready_with_policy'])
    for (const reason of ['INVALID_REQUEST', 'READINESS_UNSUPPORTED']) {
      const h = harness((f, r) =>
        f.method === method
          ? r({type: 'failed', code: 'InvalidRequest', reason, retryable: false})
          : normal(f, r)
      );
      await assert.rejects(new SeatlinePath({client: h.client}).run(target, request), {
        code: 'UPDATE_REQUIRED'
      });
      assert.ok(h.sent.every((f) => f.method !== 'send'));
      h.client.close();
    }
});
test('sign-in, isolation and option refusals prevent generation; Gemini needs explicit cloud opt-in', async () => {
  for (const [state, code] of [
    [{sign_in: 'api_key'}, 'POLICY_DENIED'],
    [{sign_in: 'unknown'}, 'POLICY_DENIED'],
    [{authentication: 'unauthenticated'}, 'SIGNED_OUT'],
    [{availability: 'not_found'}, 'NOT_INSTALLED'],
    [{capabilities: {tool_isolation: 'unknown'}}, 'ISOLATION_UNAVAILABLE']
  ]) {
    const h = harness((f, r) => {
      r({type: 'status', provider: f.provider, status: status(state)});
      r({type: 'completed'});
    });
    await assert.rejects(new SeatlinePath({client: h.client}).run(target, request), {code});
    assert.equal(h.sent.filter((f) => f.method === 'send_ready_with_policy').length, 0);
    h.client.close();
  }
  const h = harness(normal);
  let allow = false;
  const path = new SeatlinePath({client: h.client, policy: () => ({allowGeminiCloud: allow})});
  await assert.rejects(path.run({...target, provider: 'gemini'}, request), {code: 'POLICY_DENIED'});
  assert.equal(h.sent.length, 0);
  allow = true;
  await path.run({...target, provider: 'gemini'}, request);
  assert.deepEqual(h.sent.at(-1).params.allowed_sign_in, ['cloud']);
  await assert.rejects(path.run({...target, provider: 'claude', effort: 'none'}, request), {
    code: 'OPTION_UNSUPPORTED'
  });
  await assert.rejects(path.run({...target, provider: 'grok'}, {...request, kind: 'search'}), {
    reason: 'WEB_SEARCH_UNSUPPORTED'
  });
  h.client.close();
});
test('persistent continuation sends only the new task and loses no explicit session events; ephemeral chat carries history', async () => {
  const start = {...request, kind: 'chat', session: {mode: 'start'}},
    continued = {...start, session: {mode: 'continue', handle: 'broker_token'}};
  assert.equal(turnFor(target, start).system, 'Rules');
  assert.equal(turnFor(target, continued).system, null);
  assert.deepEqual(turnFor(target, continued).messages, [{role: 'user', text: 'Task'}]);
  assert.equal(turnFor(target, continued).continuation, 'broker_token');
  const ephemeral = {
    ...request,
    kind: 'chat',
    history: [
      {role: 'user', text: 'old scope'},
      {role: 'assistant', text: 'old answer'}
    ]
  };
  assert.equal(turnFor(target, ephemeral).messages.length, 3);
  const h = harness((f, r) => {
    if (f.method === 'send_ready_with_policy') {
      r({type: 'status', provider: f.provider, status: status()});
      r({type: 'session', handle: 'broker_token'});
      r({type: 'session_lost', confirmed: true});
      r({type: 'delta', text: 'reset'});
      r({type: 'completed'});
    } else normal(f, r);
  });
  const seen = [],
    result = await new SeatlinePath({client: h.client}).run(target, start, {
      onEvent: (e) => seen.push(e.type)
    });
  assert.equal(result.session, null);
  assert.ok(seen.includes('session_lost'));
  h.client.close();
});
test('request validation refuses oversized UTF-8 scopes, invalid model/options/groups and retains capped output', async () => {
  const h = harness(normal),
    path = new SeatlinePath({client: h.client});
  await assert.rejects(path.run(target, {...request, document: 'я'.repeat(500001)}), {code: 'TOO_LARGE'});
  assert.equal(h.sent.length, 0);
  for (const model of ['-bad', 'bad model', 'a'.repeat(129)])
    await assert.rejects(path.run({...target, model}, request), {code: 'MODEL_UNSUPPORTED'});
  await assert.rejects(path.run(target, {...request, cleanupGroup: '../../bad'}), {
    reason: 'INVALID_CLEANUP_GROUP'
  });
  const capped = await path.run(target, {...request, tier: 'quick', limits: {maxOutputBytes: 2}});
  assert.equal(capped.truncated, true);
  h.client.close();
});
test('failure mapping preserves retryable and reason for all integration families', () => {
  const mapping = {
    EXECUTABLE_NOT_FOUND: 'NOT_INSTALLED',
    LOGIN_REQUIRED: 'SIGNED_OUT',
    AUTH_REJECTED: 'SIGNED_OUT',
    APP_NOT_AUTHORIZED: 'NOT_AUTHORIZED',
    SIGN_IN_POLICY_DENIED: 'POLICY_DENIED',
    TOOL_ISOLATION_UNAVAILABLE: 'ISOLATION_UNAVAILABLE',
    PROVIDER_RATE_LIMITED: 'RATE_LIMITED',
    QUEUE_FULL: 'BUSY',
    QUEUE_TIMEOUT: 'BUSY',
    TURN_DEADLINE_EXCEEDED: 'TIMEOUT',
    PROVIDER_TIMEOUT: 'TIMEOUT',
    MODEL_NOT_SUPPORTED: 'MODEL_UNSUPPORTED',
    REASONING_EFFORT_UNSUPPORTED: 'OPTION_UNSUPPORTED',
    SERVICE_TIER_UNSUPPORTED: 'OPTION_UNSUPPORTED',
    PERSISTENT_SESSION_UNSUPPORTED: 'OPTION_UNSUPPORTED',
    UNKNOWN_SESSION: 'PROVIDER_FAILED',
    SESSION_LIMIT_REACHED: 'BUSY',
    PROVIDER_UNAVAILABLE: 'PROVIDER_FAILED',
    PROCESS_EXITED: 'PROVIDER_FAILED',
    MALFORMED_PROVIDER_OUTPUT: 'PROVIDER_FAILED',
    PROVIDER_FAILED: 'PROVIDER_FAILED'
  };
  for (const [reason, code] of Object.entries(mapping)) {
    const error = failure({reason, code: 'native', retryable: true}, 'send_ready_with_policy');
    assert.equal(error.code, code, reason);
    assert.equal(error.reason, reason);
    assert.equal(error.retryable, true);
  }
});
test('all setup diagnostics name the distinct integration states, and the authorize command uses the actual ID', () => {
  const id = 'npmhefooiolfpmhicinblelaideeejcm';
  assert.equal(
    authorizeCommand(id),
    `seatline-companion authorize sharh claude,codex,gemini,grok chrome-extension://${id}/ --cache-title=Sharh`
  );
  assert.throws(() => authorizeCommand('bad id'));
  const info = providerInfo('codex', status());
  const cases = [
    ['HOST_NOT_FOUND', 'NOT_INSTALLED', 'Companion missing'],
    ['ORIGIN_NOT_AUTHORIZED', 'NOT_AUTHORIZED', 'Sharh not authorized'],
    ['INVALID_REQUEST', 'UPDATE_REQUIRED', 'Companion too old'],
    ['APP_NOT_AUTHORIZED', 'NOT_AUTHORIZED', 'Provider not authorized'],
    ['EXECUTABLE_NOT_FOUND', 'NOT_INSTALLED', 'CLI missing'],
    ['LOGIN_REQUIRED', 'SIGNED_OUT', 'Signed out'],
    ['AUTH_REJECTED', 'SIGNED_OUT', 'Signed out'],
    ['SIGN_IN_POLICY_DENIED', 'POLICY_DENIED', 'Sign-in not accepted'],
    ['TOOL_ISOLATION_UNAVAILABLE', 'ISOLATION_UNAVAILABLE', 'Isolation unavailable']
  ];
  for (const [reason, code, title] of cases)
    assert.equal(diagnostic({...info, error: {reason, code}}).title, title);
  assert.equal(diagnostic({...info, available: false, availability: 'not_found'}).title, 'CLI missing');
  assert.equal(diagnostic({...info, signedIn: false, authentication: 'unauthenticated'}).title, 'Signed out');
  assert.equal(diagnostic({...info, accepted: false}).title, 'Sign-in not accepted');
  assert.equal(diagnostic({...info, capabilities: {toolIsolation: false}}).title, 'Isolation unavailable');
  assert.equal(diagnostic(info).title, 'Ready');
  assert.equal(runState({type: 'queued', ahead: 3}), 'Waiting for a free slot (3 ahead)');
  assert.match(runState({type: 'busy', retryAfter: 30000}), /30 seconds/);
});
test('pacing reserves one background turn, sends interactive immediately, and serializes idle maintenance before new work', async () => {
  const held = [];
  const h = harness((f, r) => {
    if (f.method === 'send_ready_with_policy') {
      r({type: 'status', provider: f.provider, status: status()});
      held.push([f, r]);
    } else normal(f, r);
  });
  const path = new SeatlinePath({client: h.client});
  const b1 = path.run(target, {...request, priority: 'background'}),
    b2 = path.run(target, {...request, priority: 'background'});
  await tick();
  assert.equal(held.length, 1);
  assert.deepEqual(held[0][0].scheduling, {events: true});
  const interactive = path.run(target, request);
  await tick();
  assert.equal(held.length, 2);
  assert.deepEqual(held[1][0].scheduling, {interactive: true, events: true});
  const cleanup = path.cleanup(target, 'doc-test'),
    later = path.run(target, request);
  await tick();
  assert.ok(!h.sent.some((f) => f.method === 'cleanup'));
  assert.equal(held.length, 2);
  held[1][1]({type: 'completed'});
  await interactive;
  held[0][1]({type: 'completed'});
  await b1;
  await cleanup;
  await tick();
  assert.equal(held.length, 4);
  const cleanupIndex = h.sent.findIndex((f) => f.method === 'cleanup');
  assert.ok(cleanupIndex > h.sent.indexOf(held[1][0]) && cleanupIndex < h.sent.indexOf(held[2][0]));
  held[2][1]({type: 'completed'});
  held[3][1]({type: 'completed'});
  await Promise.all([b2, later]);
  h.client.close();
});
test('background busy retries wait 10/30/60 seconds, interactive busy is final, cancelled local work is never sent', async () => {
  const delays = [],
    pacer = new RequestPacer({
      sleep: async (ms) => {
        delays.push(ms);
      }
    }),
    events = [];
  let calls = 0;
  await assert.rejects(
    pacer.run(
      'codex',
      'background',
      async () => {
        calls++;
        throw new PathError('BUSY', 'QUEUE_TIMEOUT', true);
      },
      {onEvent: (e) => events.push(e)}
    ),
    {code: 'BUSY'}
  );
  assert.equal(calls, 4);
  assert.deepEqual(delays, [10000, 30000, 60000]);
  calls = 0;
  await assert.rejects(
    pacer.run('claude', 'interactive', async () => {
      calls++;
      throw new PathError('BUSY', 'QUEUE_FULL', true);
    }),
    {code: 'BUSY'}
  );
  assert.equal(calls, 1);
  let release;
  const first = pacer.run('codex', 'background', () => new Promise((r) => (release = r))),
    signal = new AbortController();
  const second = pacer.run('claude', 'background', () => assert.fail('sent cancelled work'), {
    signal: signal.signal
  });
  signal.abort();
  await assert.rejects(second, {code: 'CANCELLED'});
  release();
  await first;
});
test('forget batches at 256 tokens and waits for an active provider turn', async () => {
  const h = harness(normal),
    path = new SeatlinePath({client: h.client});
  await path.forget(
    target,
    Array.from({length: 513}, (_, i) => `token_${i}`)
  );
  assert.deepEqual(
    h.sent.map((f) => f.params.sessions.length),
    [256, 256, 1]
  );
  h.client.close();
});

test('a readiness result finishing just before disconnect cannot restore a stale capability cache', async () => {
  let disconnected = false;
  const h = harness((frame, reply, port) => {
    normal(frame, reply);
    if (!disconnected) {
      disconnected = true;
      port.disconnect();
    }
  });
  const path = new SeatlinePath({client: h.client});
  await path.readiness('codex');
  assert.equal(path.cache.size, 0);
  await path.readiness('codex');
  assert.equal(h.ports.length, 2);
  assert.equal(path.cache.size, 1);
  h.client.close();
});

test('failed connections do not defeat preparation throttling, and invalid continuation handles never become new sessions', async () => {
  let now = 0,
    connects = 0;
  const client = new (await import('../src/paths/native-seatline.mjs')).NativeSeatline(() => {
    connects++;
    throw Error('host not found');
  });
  const path = new SeatlinePath({client, now: () => now});
  await path.prepare(target);
  await path.prepareFor('model-picker', target);
  assert.equal(connects, 1);
  now = 10000;
  await path.prepare(target);
  assert.equal(connects, 2);
  client.close();
  const h = harness(normal),
    checked = new SeatlinePath({client: h.client});
  for (const handle of [undefined, null, 123, {}, ''])
    await assert.rejects(
      checked.run(target, {...request, kind: 'chat', session: {mode: 'continue', handle}}),
      {reason: 'INVALID_SESSION'}
    );
  await assert.rejects(checked.cleanup(target, undefined), {reason: 'INVALID_CLEANUP_GROUP'});
  await assert.rejects(checked.run({...target, model: 123}, request), {reason: 'INVALID_MODEL_ID'});
  assert.equal(h.sent.length, 0);
  h.client.close();
});

test('supplied sessions must be objects with a valid mode before any quota-consuming turn', async () => {
  const h = harness(normal),
    path = new SeatlinePath({client: h.client});
  for (const session of ['continue', [], null, 42, true, {mode: null}, {mode: []}]) {
    await assert.rejects(path.run(target, {...request, session}), {
      code: 'OPTION_UNSUPPORTED',
      reason: 'INVALID_SESSION'
    });
  }
  assert.equal(h.sent.length, 0);
  assert.equal(h.ports.length, 0);
  h.client.close();
});
