# G — Scholar's toolkit evidence

Base: merged F/recovery `88ed91a5a5abab52d4665acbc6987839cacef38a`. [Accepted slice](../decisions/g-scholars-toolkit.md) · [Architecture and commands](../architecture/scholars-toolkit.md).

The owner reported on 2026-10-15 that passage actions worked after choosing Sonnet. This is recorded as a limited functional smoke result. It does not reproduce the original Haiku response or satisfy the F corpus/live quality gates.

G-01/G-02 implement scope-grounded Ask and sequential Deep read, with session identity checks, stateless resends, known-loss recovery, explicit cancellation, separate saved runs and deletion-safe chat storage. Ask about this opens a durable selection draft without generation. G-03–G-06 implement the six new lenses, views and raw evaluation shapes; real recorded quality remains IMPLEMENTED — VERIFY.

G-07 implements explicit capability-gated native search and source-event-backed links. G-08 implements independent reader outputs, deterministic evidence alignment, hand-checked agreement/kappa, contradiction comparison and saved human reconciliation. G-09 binds visible paragraphs to matching extraction versions. G-10 validates and snapshots custom definitions. G-11 exports Markdown, validated portable JSON/source files and native SVG/PNG maps. G-12 restores the shared workspace in a full tab without replay.

Seventeen new unit regression groups cover those boundaries, including rejecting an unavailable reader pair before either turn. Four packaged Chromium scenarios exercise all six lens views, Ask/Deep read/studio restoration, reconciliation/custom sharing/all four exports, search proof/HTML viewport, and PDF text-item viewport highlighting. Form controls use unique caption IDs so independent workspace instances retain exact accessible labels. CI additionally runs the six lenses over the 14-item/two-provider corpus through scripted and real pinned-broker paths (168 + 168 turns). The existing F matrices (224 + 224), browser and broker checks remain required. Final validation is linked on the PR; old evidence snapshots retain their actual source versions.

G-13 is BLOCKED. Synthetic/scripted/pinned-broker stand-ins do not establish language quality, faithfulness, usefulness, live search quality, latency or quota behavior. Real Claude/Codex outputs, natural licensed sources, expert review, the Phase 2 owner workflow and existing A/B/E/F gates remain open.
