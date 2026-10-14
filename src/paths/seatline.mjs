import contract from '../../config/seatline-contract.json' with {type: 'json'};
import {NativeSeatline, OUTPUT_CAPS, bytes} from './native-seatline.mjs';
import {PathError} from './errors.mjs';
import {RequestPacer} from './pacing.mjs';
const cached = {mode: 'cached', max_age_ms: 30000},
  fresh = {mode: 'fresh'};
const labels = {claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini (Antigravity)', grok: 'Grok'};
const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
export function allowedSignIn(provider, policy = {}) {
  return provider === 'gemini' && !policy.allowGeminiCloud
    ? []
    : contract.reading_policy.allowed_sign_in[provider] || [];
}
export function providerInfo(provider, status = {}, policy = {}) {
  const caps = status.capabilities || {};
  return {
    path: 'seatline',
    provider,
    label: labels[provider],
    available: status.availability === 'available',
    availability: status.availability ?? 'unknown',
    authentication: status.authentication ?? 'unknown',
    signedIn: status.authentication === 'authenticated',
    signIn: status.sign_in ?? null,
    accepted: allowedSignIn(provider, policy).includes(status.sign_in),
    models: Array.isArray(status.models)
      ? status.models.filter((m) => typeof m.id === 'string' && typeof m.label === 'string')
      : [],
    capabilities: {
      streaming: caps.streaming === true,
      sessions: ['claude', 'codex'].includes(provider) && caps.continuation === true,
      webSearch: provider !== 'grok' && caps.web_search === true,
      effort:
        caps.reasoning_effort === true
          ? provider === 'codex'
            ? ['none', ...levels]
            : provider === 'claude'
              ? [...levels]
              : []
          : [],
      serviceTier: provider === 'codex' && caps.service_tier === true ? ['standard', 'fast'] : [],
      toolIsolation: caps.tool_isolation === true,
      schemaOutput: false,
      promptCaching: false,
      maxRequestBytes: 1000000,
      reportsUsage: ['claude', 'codex'].includes(provider)
    }
  };
}
export function assertReady(info, target, request, policy) {
  if (!info.available)
    throw info.availability === 'not_found'
      ? new PathError('NOT_INSTALLED', 'EXECUTABLE_NOT_FOUND')
      : new PathError('PROVIDER_FAILED', 'PROVIDER_UNAVAILABLE', true);
  if (!info.signedIn)
    throw info.authentication === 'unauthenticated'
      ? new PathError('SIGNED_OUT', 'LOGIN_REQUIRED')
      : new PathError('PROVIDER_FAILED', 'AUTH_UNVERIFIED', true);
  if (!allowedSignIn(info.provider, policy).includes(info.signIn))
    throw new PathError('POLICY_DENIED', 'SIGN_IN_POLICY_DENIED');
  if (!info.capabilities.toolIsolation)
    throw new PathError('ISOLATION_UNAVAILABLE', 'TOOL_ISOLATION_UNAVAILABLE');
  if (target.effort && !info.capabilities.effort.includes(target.effort))
    throw new PathError('OPTION_UNSUPPORTED', 'REASONING_EFFORT_UNSUPPORTED');
  if (target.serviceTier && !info.capabilities.serviceTier.includes(target.serviceTier))
    throw new PathError('OPTION_UNSUPPORTED', 'SERVICE_TIER_UNSUPPORTED');
  if (request.kind === 'search' && !info.capabilities.webSearch)
    throw new PathError('OPTION_UNSUPPORTED', 'WEB_SEARCH_UNSUPPORTED');
  if (request.session?.mode !== 'none' && request.session?.mode && !info.capabilities.sessions)
    throw new PathError('OPTION_UNSUPPORTED', 'PERSISTENT_SESSION_UNSUPPORTED');
}
function validate(target, request) {
  if (target.path !== 'seatline' || !contract.providers.includes(target.provider))
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_TARGET');
  if (target.model && !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/.test(target.model))
    throw new PathError('MODEL_UNSUPPORTED', 'INVALID_MODEL_ID');
  if (
    !['analysis', 'chat', 'search', 'repair'].includes(request.kind) ||
    typeof request.task !== 'string' ||
    typeof request.rules !== 'string' ||
    (request.document != null && typeof request.document !== 'string') ||
    !['interactive', 'background'].includes(request.priority)
  )
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_REQUEST');
  if (request.cleanupGroup != null && !/^[A-Za-z0-9_-]{1,64}$/.test(request.cleanupGroup))
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_CLEANUP_GROUP');
  if (request.history && !Array.isArray(request.history))
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_HISTORY');
  if (request.history?.some((m) => !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string'))
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_HISTORY');
  const mode = request.session?.mode || 'none';
  if (
    !['none', 'start', 'continue'].includes(mode) ||
    (mode === 'continue' && !/^[A-Za-z0-9_-]{1,256}$/.test(request.session.handle))
  )
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_SESSION');
  if (mode !== 'none' && !['chat', 'analysis'].includes(request.kind))
    throw new PathError('OPTION_UNSUPPORTED', 'PERSISTENT_SESSION_UNSUPPORTED');
  if (request.tier && !['quick', 'analysis', 'synthesis'].includes(request.tier))
    throw new PathError('OPTION_UNSUPPORTED', 'INVALID_TIER');
}
export function turnFor(target, request) {
  const mode = request.session?.mode || 'none',
    continued = mode === 'continue';
  const prompt = continued
    ? request.task
    : [request.document, request.task].filter((v) => v != null && v !== '').join('\n\n');
  return {
    system: continued ? null : request.rules || null,
    messages: [...(continued ? [] : request.history || []), {role: 'user', text: prompt}],
    model: target.model || null,
    ...(target.effort ? {reasoning_effort: target.effort} : {}),
    ...(target.serviceTier ? {service_tier: target.serviceTier} : {}),
    tools: request.kind === 'search' ? 'native_web_search' : 'none',
    session: mode === 'none' ? 'ephemeral' : 'persistent',
    continuation: continued ? request.session.handle : null,
    cleanup_group: request.cleanupGroup || null,
    check_sign_in: false
  };
}
export class SeatlinePath {
  id = 'seatline';
  label = 'Seatline';
  constructor({
    client,
    connectNative,
    policy = () => ({allowGeminiCloud: false}),
    now = Date.now,
    pacer
  } = {}) {
    this.client = client || new NativeSeatline(connectNative);
    this.policy = policy;
    this.now = now;
    this.cache = new Map();
    this.connectionEpoch = 0;
    this.lastPrepare = new Map();
    const onClose = this.client.onClose || (() => {});
    this.client.onClose = (error) => {
      this.cache.clear();
      this.connectionEpoch++;
      this.lastPrepare.clear();
      onClose(error);
    };
    this.pacer = pacer || new RequestPacer({onActivity: (count) => this.client.setJobsActive?.(count)});
  }
  async readiness(provider, isFresh = false, signal) {
    const epoch = this.connectionEpoch;
    const result = await this.client.request(provider, 'readiness', isFresh ? fresh : cached, {signal});
    if (epoch === this.connectionEpoch) this.cache.set(provider, {status: result.status, at: this.now()});
    return providerInfo(provider, result.status, this.policy());
  }
  async discover({fresh = false} = {}) {
    return Promise.all(
      contract.providers.map(async (provider) => {
        try {
          const previous = this.cache.get(provider);
          return !fresh && previous && this.now() - previous.at < 30000
            ? providerInfo(provider, previous.status, this.policy())
            : await this.readiness(provider, fresh);
        } catch (error) {
          return {
            ...providerInfo(provider, {}, this.policy()),
            error: {code: error.code, reason: error.reason, hint: error.hint, retryable: error.retryable}
          };
        }
      })
    );
  }
  async prepare(target) {
    const provider = target.provider;
    if (!contract.providers.includes(provider)) return;
    if (this.now() - (this.lastPrepare.get(provider) ?? -Infinity) < 10000) return;
    this.lastPrepare.set(provider, this.now());
    try {
      const epoch = this.connectionEpoch;
      const result = await this.client.request(provider, 'prepare', cached);
      if (epoch === this.connectionEpoch) this.cache.set(provider, {status: result.status, at: this.now()});
    } catch {
      /* unsolicited warm-up stays quiet */
    }
  }
  prepareFor(trigger, target) {
    if (!['panel-document', 'passage-toolbar', 'model-picker', 'job-start'].includes(trigger))
      return Promise.resolve();
    return this.prepare(target);
  }
  async run(target, request, {signal, onEvent = () => {}} = {}) {
    validate(target, request);
    // Measure before connecting even for a policy denial, so oversized scopes never reach Native Messaging.
    const turn = turnFor(target, request),
      kind = request.tier || request.kind;
    const limit = request.limits?.maxOutputBytes ?? OUTPUT_CAPS[kind];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > OUTPUT_CAPS[kind])
      throw new PathError('TOO_LARGE', 'INVALID_OUTPUT_LIMIT');
    if (
      bytes(
        JSON.stringify({
          id: '0'.repeat(36),
          provider: target.provider,
          method: 'send_ready_with_policy',
          params: {turn, freshness: cached, allowed_sign_in: ['subscription']},
          scheduling: {interactive: true, events: true}
        })
      ) > 1000000
    )
      throw new PathError('TOO_LARGE', 'REQUEST_TOO_LARGE');
    return this.pacer.run(
      target.provider,
      request.priority,
      async () => {
        if (request.priority === 'background') await this.prepareFor('job-start', target);
        if (!allowedSignIn(target.provider, this.policy()).length)
          throw new PathError('POLICY_DENIED', 'SIGN_IN_POLICY_DENIED');
        for (let attempt = 0; ; attempt++) {
          const info = await this.readiness(target.provider, attempt > 0, signal);
          assertReady(info, target, request, this.policy());
          try {
            const result = await this.client.request(
              target.provider,
              'send_ready_with_policy',
              {turn, freshness: cached, allowed_sign_in: allowedSignIn(target.provider, this.policy())},
              {
                signal,
                onEvent,
                kind,
                maxOutputBytes: limit,
                scheduling:
                  request.priority === 'interactive' ? {interactive: true, events: true} : {events: true},
                onStatus: (status) =>
                  assertReady(
                    providerInfo(target.provider, status, this.policy()),
                    target,
                    request,
                    this.policy()
                  )
              }
            );
            return {...result, target: {...target}, truncated: false};
          } catch (error) {
            if (error.reason === 'OUTPUT_CAP_EXCEEDED')
              return {...error.partial, target: {...target}, truncated: true};
            if (
              !attempt &&
              ['READINESS_CHANGED', 'READINESS_EXPIRED', 'READINESS_UNVERIFIED'].includes(error.reason)
            )
              continue;
            this.cache.delete(target.provider);
            throw error;
          }
        }
      },
      {signal, onEvent}
    );
  }
  async forget(target, sessionHandles) {
    if (
      !contract.providers.includes(target.provider) ||
      !Array.isArray(sessionHandles) ||
      sessionHandles.some((h) => typeof h !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(h))
    )
      throw new PathError('OPTION_UNSUPPORTED', 'INVALID_SESSION');
    return this.pacer.maintain(target.provider, async () => {
      for (let i = 0; i < sessionHandles.length; i += 256)
        await this.client.request(target.provider, 'forget', {sessions: sessionHandles.slice(i, i + 256)});
    });
  }
  async cleanup(target, group) {
    if (!contract.providers.includes(target.provider) || !/^[A-Za-z0-9_-]{1,64}$/.test(group))
      throw new PathError('OPTION_UNSUPPORTED', 'INVALID_CLEANUP_GROUP');
    return this.pacer.maintain(target.provider, () =>
      this.client.request(target.provider, 'cleanup', {group})
    );
  }
}
