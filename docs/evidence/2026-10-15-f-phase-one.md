# Slice F — prompts and evaluation

Base: merged E `12cd2db539e1085dbb8b3e68e74c035d7297bd66`. [Scope decision](../decisions/f-phase-one-evaluation.md) · [Harness and owner commands](../architecture/phase-one-evaluation.md).

F-01–F-06 are implemented: versioned shared rules, Summary/Structure/Logic/Thinking instructions and explicit Explain/Translate/Logic/Define tasks. Required live/recorded provider-output quality remains **IMPLEMENTED — VERIFY**. F-07 supplies the production reader/engine/path harness, original-output metrics, JSON reports and identity-bound five-dimension review forms. Its CI matrix is 224 scripted runs and 224 pinned-companion stand-in runs; these are integration checks, not live quality measurements.

Local unit regressions cover trusted instructions and task identity, all eight tasks in six corpus languages/scripts, raw references/quotes/graph/heading defects, sequential matrix persistence/checkpoints, repair not laundering defects, non-streaming output and continued matrix execution after failures, review-form identities/ratings and fail-closed CLI modes. Chromium/broker evidence runs in CI because the local browser binary is unavailable. Validation results and exact CI source will be linked on the PR; no report is relabelled as another source.

F-08 is **BLOCKED**, not accepted. The owner must supply live Claude/Codex corpus reports, completed expert review, naturally occurring licensed source texts and outstanding A/B/E owner gates. The synthetic fixtures do not establish language or semantic quality, actual injection resistance, latency or quota behaviour. Prompt-version-1 runs stay viewable but cannot continue under version 2.
