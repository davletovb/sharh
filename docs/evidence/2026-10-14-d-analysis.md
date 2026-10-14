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

- Local `npm run test:unit`: **107/107 passing** (83 existing + 24 new).
- Local `npm run build` and `git diff --check`: passing.
- Local browser validation cannot start because the Chromium executable is absent in this workspace. The unchanged production manifest, browser regression suite and pinned real-broker integration are run in CI; current run evidence will be linked on the PR.
- No live provider run or owner-machine validation is claimed. A-02, A-03 and B-05 remain open. E's lens controls/specialized views and F's final prompt-quality work are not part of D.
