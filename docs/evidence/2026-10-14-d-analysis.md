# D — Analysis engine evidence

Source: branch `codex/d-analysis-engine`, based on merged C `603dae78b883eba8ad87e29ee3758149289cdbb8`.

## Implementation

| Item | Evidence |
| --- | --- |
| D-01 | Shared versioned contract and three-layer prompt builder; scoped numbered JSON preserves language, headings, notes, printed pages, context and selections. Unit checks use production `turnFor` for first/continued Seatline placement. Runs retain prompt/configuration identity. |
| D-02 | Production incremental allowlist validator covers framing, fields/enums/caps, references, quotations, identifiers/cycles and completion. Recorded malformed/fenced/truncated/adversarial fixtures and text-only rendering checks. |
| D-03 | English, Russian, Uzbek Latin/Cyrillic, Turkish and Arabic fixtures; punctuation/NFC/soft-hyphen normalization, ellipses, adjacent paragraph boundaries, repeated matches and rejection of neighbour-only/disjoint matches. |
| D-04 | Exactly one repair below 80%, excluding control/fence lines. Fake-path tests cover failed repair, linked session/sessionless continuation, context loss, cancellation and no implicit replay. |
| D-05 | Transactional version allocation, incremental/final storage, stale preservation, deletion race guards and maintenance retries. The real-broker script verifies session-bound cascade/forget/cleanup through the production worker. |
| D-06 | Explicitly injected recorded/timed fake path; packaged browser test streams 200 records, repairs malformed output, continues a partial run, reloads IndexedDB and checks that model HTML remains text. |

## Validation state

- The [immutable baseline snapshot](2026-10-14-d-validation.json) records [CI run 38548748062](https://github.com/davletovb/sharh/actions/runs/38548748062) at source `8be206096f340047640326ec595cc08c9fa37a26`: **107 unit tests, 12 browser tests**, the existing **16 real-broker path checks**, and **4 additional production-engine/broker checks**, all passing. All corpus fixtures and the 56-run draft-output probe also pass.
- The downloaded browser/broker reports and package report are copied exactly into that source-labelled snapshot. The 200-record text sink's maximum measured render callback was 2.1 ms on that CI runner (a scripted UI test, not live-model latency). Its screenshot was inspected: model markup stays text. The extension package is reproducible.
- Final hardening preserves canonical unanchored/failed-quote records and path-capped output. Review regressions also reject empty/mostly malformed repairs without losing useful records, and seed retained history locally while repairing only the current attempt. The large-history test retains over 32 KiB independently of the repair cap; the browser continuation test also exercises repair without resending history. **111/111 unit tests pass locally** (83 existing + 28 new); build, package reproducibility and `git diff --check` pass. The final-head CI run is linked from the PR; the baseline snapshot is not relabelled as that head.
- Local browser execution is unavailable because Chromium is absent in this workspace; browser and real-broker execution use CI with the unchanged production manifest.
- No live provider run or owner-machine validation is claimed. A-02, A-03 and B-05 remain open. E's lens controls/specialized views and F's final prompt-quality work are not part of D.

## Additional review hardening

The 15 further inline findings are covered by `tests/d-review-regressions.test.mjs`: tolerant optional fields and completion, common ellipses, preserving larger useful attempts, canonical history/import trust, live owner protection/orphan recovery, session ownership and context reconstruction, terminal/attempt metrics, complete-frame preflight and compact continuation, record-only writes and revision-safe maintenance. The canonical baseline snapshot above remains immutable and source-labelled.

Local checks pass **130 unit tests**, extension build, reproducible packaging and `git diff --check`. New CI gates add two-page closed-owner recovery in packaged Chromium and a fifth engine/broker check that closes a caller before it can save its session, then verifies worker journaling and actual deletion maintenance. Their final run is linked on the PR after execution; no live-provider result is inferred from them.
