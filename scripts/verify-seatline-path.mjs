// Production B client/path through the pinned real broker and upstream fake CLIs. No live-model claim.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {readFile, writeFile, mkdir, cp, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {isolatedCompanion} from './lib/isolated-companion.mjs';
import {nativePort} from './lib/native-stdio.mjs';
import {browserOptions} from './lib/browser-fixtures.mjs';
import {NativeSeatline} from '../src/paths/native-seatline.mjs';
import {SeatlinePath, turnFor} from '../src/paths/seatline.mjs';
const {values} = parseArgs({
  options: {
    companion: {type: 'string'},
    'fake-provider': {type: 'string'},
    out: {type: 'string', default: 'test-results/seatline-path.json'}
  }
});
if (!values.companion || !values['fake-provider']) throw Error('Use --companion PATH --fake-provider PATH');
const world = await isolatedCompanion(resolve(values.companion), resolve(values['fake-provider']), {
  officialProviders: true
});
const report = {
  kind: 'production-seatline-path-stand-ins',
  liveProviderClaim: false,
  revision: world.contract.revision,
  checks: {}
};
const ports = [],
  frames = [];
let context, profile;
const client = new NativeSeatline(() => {
  const port = nativePort(world.installed, world.origin, world.env),
    post = port.postMessage.bind(port);
  port.postMessage = (frame) => {
    frames.push(frame);
    post(frame);
  };
  ports.push(port);
  return port;
});
const path = new SeatlinePath({client}),
  target = {path: 'seatline', provider: 'codex', model: null};
const request = {
  kind: 'analysis',
  rules: '',
  document: null,
  task: 'answers test',
  session: {mode: 'none'},
  history: [],
  priority: 'interactive',
  cleanupGroup: 'doc-0123456789abcdef'
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return {promise, resolve};
};
const timeout = (promise, ms = 10000) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('TEST_TIMEOUT')), ms);
    })
  ]).finally(() => clearTimeout(timer));
};
const countRuns = async () => {
  try {
    return (await readFile(join(world.providers, 'codex-pids'), 'utf8')).trim().split('\n').filter(Boolean)
      .length;
  } catch {
    return 0;
  }
};
try {
  const discovered = await path.discover({fresh: true});
  assert.ok(
    discovered
      .filter((p) => ['claude', 'codex'].includes(p.provider))
      .every((p) => p.accepted && p.capabilities.toolIsolation),
    JSON.stringify(discovered)
  );
  report.checks.discovery = true;
  let resolved = false;
  const deltas = [];
  const stream = path.run({...target, provider: 'claude'}, request, {
    onEvent: (event) => {
      if (event.type === 'delta') {
        assert.equal(resolved, false);
        deltas.push(event.text);
      }
    }
  });
  const answer = await stream;
  resolved = true;
  assert.equal(answer.text, 'First. Second.');
  assert.ok(deltas.length >= 2);
  report.checks.streaming = {chunks: deltas.length, text: answer.text};

  const start = await path.run(target, {
    ...request,
    kind: 'chat',
    document: 'first scope',
    session: {mode: 'start'}
  });
  assert.ok(start.session);
  assert.ok(start.usage);
  const continued = await path.run(target, {
    ...request,
    kind: 'chat',
    task: 'answers follow-up',
    session: {mode: 'continue', handle: start.session}
  });
  assert.equal(continued.session, start.session);
  const sendFrames = frames.filter((f) => f.method === 'send_ready_with_policy');
  assert.equal(sendFrames.at(-1).params.turn.system, null);
  assert.deepEqual(sendFrames.at(-1).params.turn.messages, [{role: 'user', text: 'answers follow-up'}]);
  const invocations = await readFile(join(world.providers, 'codex-invocations'), 'utf8');
  assert.match(invocations, /resume/);
  report.checks.sessionContinuation = true;
  await path.forget(target, [start.session]);
  await path.cleanup(target, request.cleanupGroup);
  report.checks.maintenance = true;

  const cap = await path.run(
    {...target, provider: 'claude'},
    {...request, tier: 'quick', limits: {maxOutputBytes: 8}}
  );
  assert.equal(cap.truncated, true);
  assert.ok(cap.text.startsWith('First.'));
  assert.ok(Buffer.byteLength(cap.text) <= 8);
  report.checks.outputCap = true;
  const beforeFrames = frames.length;
  await assert.rejects(path.run(target, {...request, document: 'я'.repeat(500001)}), {code: 'TOO_LARGE'});
  assert.equal(frames.length, beforeFrames);
  report.checks.oversizeRefusedBeforePost = true;

  const abort = new AbortController(),
    started = deferred(),
    events = [];
  const cancel = path.run(
    target,
    {...request, task: 'goes-quiet cancel'},
    {
      signal: abort.signal,
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === 'started') started.resolve();
      }
    }
  );
  await timeout(started.promise);
  abort.abort();
  await assert.rejects(cancel, {code: 'CANCELLED'});
  assert.ok(frames.some((f) => f.method === 'cancel' && typeof f.target === 'string'));
  report.checks.cancellation = true;

  const disconnected = deferred(),
    beforeConnects = ports.length;
  const lost = path.run(
    target,
    {...request, task: 'goes-quiet disconnect'},
    {
      onEvent: (event) => {
        if (event.type === 'started') disconnected.resolve();
      }
    }
  );
  await timeout(disconnected.promise);
  ports.at(-1).disconnect();
  await assert.rejects(lost, {code: 'DISCONNECTED'});
  assert.equal(ports.length, beforeConnects);
  await path.discover({fresh: true});
  assert.equal(ports.length, beforeConnects + 1);
  report.checks.disconnectWithoutReplay = true;

  // A provider sign-in changed to API key. Preflight and the broker's protected send both refuse it with zero launches.
  await writeFile(join(world.providers, 'codex-scenario'), 'login=signed-in\nexec=by-prompt\n');
  await path.discover({fresh: true});
  const beforeRuns = await countRuns();
  await assert.rejects(path.run(target, request), {code: 'POLICY_DENIED'});
  const deniedEvents = [];
  await assert.rejects(
    client.request(
      'codex',
      'send_ready_with_policy',
      {
        turn: turnFor(target, request),
        freshness: {mode: 'cached', max_age_ms: 30000},
        allowed_sign_in: ['subscription']
      },
      {onEvent: (e) => deniedEvents.push(e.type)}
    ),
    {reason: 'SIGN_IN_POLICY_DENIED'}
  );
  assert.equal(await countRuns(), beforeRuns);
  assert.ok(!deniedEvents.includes('launched'));
  report.checks.policyDenialNoLaunch = true;
  await writeFile(join(world.providers, 'codex-scenario'), 'login=subscription\nexec=by-prompt\n');
  await path.discover({fresh: true});

  // Intentionally bypass the local pacer to fill both real broker generation slots, then time out a third queued turn.
  const controllers = [new AbortController(), new AbortController()],
    ready = [deferred(), deferred()];
  const protectedParams = {
    turn: turnFor(target, {...request, task: 'goes-quiet hold'}),
    freshness: {mode: 'cached', max_age_ms: 30000},
    allowed_sign_in: ['subscription']
  };
  const held = controllers.map((controller, i) =>
    client.request('codex', 'send_ready_with_policy', protectedParams, {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === 'started') ready[i].resolve();
      }
    })
  );
  // Install rejection handlers immediately; a CI assertion must not leak a running fake process.
  const settled = Promise.allSettled(held);
  try {
    await timeout(Promise.all(ready.map((d) => d.promise)));
    const queued = [];
    await assert.rejects(
      client.request('codex', 'send_ready_with_policy', protectedParams, {
        scheduling: {interactive: true, events: true, queue_timeout_ms: 80},
        onEvent: (e) => queued.push(e.type)
      }),
      {reason: 'QUEUE_TIMEOUT', code: 'BUSY'}
    );
    assert.ok(queued.includes('queued'));
    report.checks.queueTimeout = true;
  } finally {
    controllers.forEach((c) => c.abort());
    await settled;
  }

  const backgroundStarted = deferred(),
    backgroundAbort = new AbortController();
  let backgroundDone = false;
  const background = path.run(
    target,
    {...request, task: 'goes-quiet background', priority: 'background'},
    {
      signal: backgroundAbort.signal,
      onEvent: (e) => {
        if (e.type === 'started') backgroundStarted.resolve();
      }
    }
  );
  const backgroundSettled = background.then(
    () => {
      backgroundDone = true;
    },
    (error) => {
      backgroundDone = true;
      assert.equal(error.code, 'CANCELLED');
    }
  );
  await timeout(backgroundStarted.promise);
  const action = await timeout(path.run(target, {...request, task: 'answers passage action'}));
  assert.ok(action.text.includes('passage action'));
  assert.equal(backgroundDone, false);
  backgroundAbort.abort();
  await backgroundSettled;
  report.checks.interactiveDuringBackground = true;

  // Actual installed production extension, worker RPC, settings and two concurrent extension pages share one native connection.
  client.close();
  profile = await mkdtemp(join(tmpdir(), 'sharh-b-chrome-'));
  await mkdir(join(profile, 'NativeMessagingHosts'), {recursive: true});
  await cp(
    join(world.env.XDG_CONFIG_HOME, 'google-chrome/NativeMessagingHosts/com.seatline.host.json'),
    join(profile, 'NativeMessagingHosts/com.seatline.host.json')
  );
  const extension = resolve('dist/sharh');
  context = await chromium.launchPersistentContext(profile, {
    ...browserOptions(),
    channel: 'chromium',
    env: world.env,
    args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    ignoreDefaultArgs: ['--disable-extensions']
  });
  const page = await context.newPage();
  await page.goto(`${world.origin}ui/settings.html`);
  await page.locator('#check').click();
  await page.waitForFunction(
    () => document.querySelector('#check-state').textContent === 'Fresh check complete.'
  );
  assert.equal(await page.locator('[data-state="ready"]').count(), 3);
  assert.equal(await page.locator('[data-state="sign_in_not_accepted"]').count(), 1);
  const uiResult = await page.evaluate(
    async ({target, request}) => {
      const {PathClient} = await import('./client.mjs');
      const client = new PathClient(),
        events = [];
      const result = await client.call('run', {target, request}, {onEvent: (e) => events.push(e.type)});
      return {result, events};
    },
    {target, request}
  );
  assert.ok(uiResult.result.text);
  assert.ok(uiResult.events.includes('delta'));
  report.checks.productionExtensionRPC = true;
  assert.ok(frames.every((f) => !['send', 'send_ready'].includes(f.method)));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = {message: error.message, stack: error.stack};
  process.exitCode = 1;
} finally {
  client.close();
  await context?.close();
  await world.close();
  if (profile) await rm(profile, {recursive: true, force: true});
  await mkdir(dirname(values.out), {recursive: true});
  await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks,
      report: values.out,
      failure: report.failure
    })
  );
}
