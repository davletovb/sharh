# B slice — Seatline path

Date: 2026-10-14. Owner: Codex. Seatline pin: `ba712f70eb4acd43b45b326bb4907feb9ded9c2f`.

This slice implements B-01–B-07. It does not claim live-provider behavior. The owner-Chrome part of B-05 and the A-02/A-03 live gates remain outstanding.

## Implementation

- `extension/` is the production MV3 extension. Its key preserves development ID `npmhefooiolfpmhicinblelaideeejcm`. Only the seven framework permissions are required; HTTP, HTTPS and file origins are optional, and none is granted at installation. The worker, side panel and Seatline settings are bundled locally. The A probe moved to `probes/extension/` and still builds to `dist/probe`.
- `src/paths/native-seatline.mjs` adapts Lineleaf's client at `c6403c5`. One worker connection streams validated events, measures UTF-8 request/output sizes, cancels by top-level target, drains cancelled turns and preserves capped partial output. Only persistent requests accept session events. It reconnects for subsequent work, clears readiness on disconnect and never replays a posted request. Even a `postMessage` exception is treated as ambiguous. A connection lost after readiness but before posting gets one safe retry. Default request deadlines include the broker queue allowance before the execution deadline. A 60-second idle timer closes the native port; queued local jobs and backoff keep it open.
- `src/paths/seatline.mjs` implements discover, prepare, run, forget and cleanup. Unknown capabilities are absent; persistent sessions are Claude/Codex-only at this pin. Model, option, group, session and request sizes are checked. Quick/repair, analysis/chat/search and synthesis output caps are 32/256/512 KiB. A cap returns the retained text with `truncated: true`.
- Every generation follows readiness with `send_ready_with_policy`, `check_sign_in: false` and the provider's explicit allowed sign-in list. Gemini cloud use is off until enabled in local settings. Readiness changes/expiry/unverified refusals get exactly one fresh check and retry. Policy denials are final. An old companion gets `UPDATE_REQUIRED`, without plain-send fallback.
- `prepareFor` provides the four document-panel, passage-toolbar, model-picker and job-start triggers, throttled to ten seconds per provider. Future C/E/H surfaces use these worker routes; B supplies the connection scaffold, not document reading or lenses.
- `src/paths/pacing.mjs` keeps one background task active, including backoff, with later background work waiting locally. Interactive turns carry priority hints immediately. Only broker queue-full/timeout background failures retry at 10/30/60 seconds. Queued/busy status, stop and reader-triggered retry are bound in the panel. Maintenance creates a provider barrier, waits for active turns and blocks new ones until complete; forget batches at 256 handles.
- Settings names each setup state, uses the actual runtime extension ID in the authorize command and offers a copy button. Model text is never inserted as HTML. The native grant token stays in Seatline. Only same-extension pages can use the worker's path port.

Transport/path failures retain neutral code, native reason and retryability. Replay, failover, lost-session reconstruction and session-age housekeeping belong to later D/G/H consumers; B surfaces their failures/events without silently regenerating.

## Verification

Local validation: 48 unit tests passed, including the 24 production transport/path tests. Two clean builds produced identical extension ZIP hashes; Python's independent ZIP reader accepted every entry and CRC. Reports are generated under `test-results/`.

CI runs:

- `npm run verify`: existing corpus/prototype/probe regressions plus the production client's scripted tests and a Playwright install of `dist/sharh`. The browser test verifies fixed identity, worker, side panel/settings, optional hosts, copy behavior, missing-host diagnostics and queued/busy retry UI.
- `node scripts/verify-package.mjs`: two independent clean builds and ZIP hashes, recorded in `package.json` under the CI results directory.
- `npm run test:companion -- --companion PATH --fake-provider PATH`: builds on the same isolated broker harness as A, using Seatline's upstream fake CLI personas. It checks real streaming/usage, cancellation, disconnect without replay, output truncation, oversize refusal before posting, persistent continuation and cleanup, policy denial with no provider process launch, a real 80-ms queue timeout, and an interactive passage turn while a background turn remains active. It also drives a protected turn through the installed production extension's worker RPC. The generated report is `test-results/seatline-path.json`.

[CI run 38513944497](https://github.com/davletovb/sharh/actions/runs/38513944497) passed both jobs: 48 unit tests, six browser tests, reproducible packaging, the 56 A probe runs, and all 13 B broker/extension checks. The [recorded CI snapshot](2026-10-14-b-validation.json) includes the run/commit, verified package hash and the unmodified path report from its artifact. [PR #3](https://github.com/davletovb/sharh/pull/3) carries the final-head checks. These stand-ins measure plumbing, not model quality, real latency, subscriptions or quota.

## Owner-Chrome gate (B-05)

Load `dist/sharh` from `npm run package` in the owner's Chrome. In Settings → Seatline, check the command and copy button, then record every integration diagnostics state: companion missing, Sharh not authorized, companion too old, provider not authorized, CLI missing, signed out, sign-in not accepted (including Gemini opt-in), and isolation unavailable. Return the CLI configuration and grants to the intended state afterward. This is not marked DONE until the owner-machine observations are recorded.
