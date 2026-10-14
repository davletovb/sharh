# Slice E — workspace, views and passage actions

Source: the slice E branch based on merged D `e919f7843929657872c5d2632da67b9f302a72c2`. No live-provider or screen-reader claim.

| Item | Implementation and acceptance evidence |
| --- | --- |
| E-01 | Shared panel/reader workspace, document/scope/full-frame size/language/target header, Analyze/Ask/Library areas, system/ink/parchment themes and bundled Noto Latin/Cyrillic/Arabic reading fonts. Packaged browser checks cover theme accessibility and RTL/font loading. |
| E-02 | Capability-aware path/provider/model picker, optional free model IDs, advertised effort/speed, four persisted tier defaults and per-run overrides. Unit tests cover validation, capability removal and saved overrides. |
| E-03 | Summary/arc, outline/mind map, argument/steps/gaps and concepts/causal relations/facets. The browser streams 200 records through the actual engine/controller and measures render callbacks and PerformanceObserver long tasks; maps must appear before generation ends. Each map retains a text outline. |
| E-04 | Reference buttons and finding inspection show saved source paragraphs/basis. Existing C anchor fallback remains in use. Real-broker workspace coverage clicks a rendered reference; historical comparisons use their original extraction versions. |
| E-05 | Four passage actions use selected spans/context, output language and Quick tier. Source-site optional permission, keyboard activation, panel handoff and revocation, plus PDF selection, have packaged-browser checks. Unit tests inspect every action's actual serialized request. |
| E-06 | Saved runs load without generation; versions compare side by side. Unit tests use D engine storage, and the real-broker script drives actual Analyze/Continue/reload/Compare controls. |
| E-07 | axe WCAG A/AA checks on panel/settings and four views in both themes; keyboard, visible focus and reduced motion. **Owner screen-reader pass remains required.** |

## Verification

Local: **151 unit tests pass**, extension build, reproducible package check and `git diff --check`. Chromium is unavailable in this workspace and its download is blocked; packaged browser and pinned real-broker checks run in CI. The [source-labelled baseline snapshot](2026-10-14-e-baseline-ce2a264.json) copies [CI 38587839760](https://github.com/davletovb/sharh/actions/runs/38587839760) at `ce2a264` exactly: 139 unit tests, 15 browser tests, 16 path checks and 6 engine/workspace broker checks all pass. All 12 axe scans have zero violations. The first review fixes added three unit regressions (142 total), outside-article browser coverage and retryable setup. The subsequent review adds eight regression groups (150 total) and a sixteenth packaged-browser test for historical navigation, paragraph deep links, inspection and permission recovery. The final pass adds a unit test for source recovery (151 total); the sixteenth browser test now also covers the reader's recovery and the stop when a grant cannot help. The baseline filename includes its source commit so it cannot be mistaken for current validation. PR #6 links final reviewed-head CI; the baseline is not relabelled as that head. CI evidence includes `e-views.json`, `e-passages.json`, two theme screenshots and the production workspace/broker check.

Model output is always text, the production manifest/key remain unchanged, and no test/fake/axe code ships in the package. E's basic action routing does not complete F's live lens/passage quality work. A-02/A-03/B-05 remain open.

## Owner screen-reader gate (E-07)

In Chrome on the owner's machine, record OS, Chrome, screen reader/version and source commit. In both themes, traverse the panel, model/tier/language controls, each Phase 1 view's text outline and inspector, source references, selection toolbar, saved run chooser and version comparison. Confirm names/order, stated/inferred labels, paragraph/page references, status announcements and keyboard escape from maps/toolbars. Exercise a PDF and Uzbek Latin/Cyrillic plus Arabic text. Record actual results and remaining issues here before changing E-07 to DONE.

## Review hardening

Selections outside the main article fall back to a visible whole-page extraction that includes an explicitly selected sidebar/footer/navigation. Its anchors retain that mode, so quote fallback still works. Ordinary extraction keeps its existing exclusions.

A passage intention survives document/discovery/selection setup failures and offers Retry/Dismiss. An awaited engine begin hook journals the intention ID against a durably allocated run and acknowledges it before a provider send. If acknowledgement fails, the run is interrupted and no generation is sent. Recovery opens that accepted run instead of replaying the passage. Regressions cover setup failures, acknowledgement errors and zero duplicate submissions.

## Follow-up review regressions

Passages capture extraction and spans together, defer full-page extraction until a click, and leave the reader extraction and Analysis target/scope intact. Provider-default effort/speed persist as nulls. Alternate passage extractions do not replace the current article or stale its runs. An active analysis leaves a passage pending for Retry; passage requests ignore invalid Analyze budgets. Escape stays dismissed until the selection changes, unrelated/editable selection events do no extraction work, and late toolbar work cannot hide the winning selection.

Inspection no longer navigates. Historical paragraph references preserve the reader workspace and source connection, and reader deep links jump after opening releases its busy guard. Source injection failures offer the same Allow action and access guidance in both surfaces. Chrome hides a tab's address once access is lost, so the action falls back to the site of the document being read and, when that grant cannot help (the tab is on another site), stops with guidance instead of offering the same action again. Durable completion releases controllers without waiting for a visible animation frame. Library dates are persisted, and the unused second Activity/Stop surface is removed.
