# Scholar's toolkit (G)

`extension/ui/toolkit.mjs` mounts the G controls in the shared panel/reader workspace. The studio is the same reader/controller opened with a session-local saved-view intent. It restores extraction, scope, run/version comparison, conversation and reader pair without generating output. A saved-scope picker option keeps the restored selection visible and reusable. Existing source inspection and all lens views remain available.

## Ask and Deep read

`src/toolkit/conversations.mjs` stores questions and answer-run IDs in `chats`. Answers use the regular parser and run store; only supplied `[¶n]` citations backed by validated references become buttons. Text and model markup remain inert. Ask streams validated notes, offers Stop, and restores history without contacting a provider. Ask about this creates an acknowledged draft on the exact selection; Send question is a separate explicit action.

Claude/Codex session support is discovered through the path. A following answer or Deep-read lens can reuse a completed, reusable session only after checking document ID, extraction version, scope identity, target and prompt version. Ask additionally binds a stable prompt identity with an empty question/history, covering Focus, Frame, budget, language and task settings while allowing questions/history to change. Continued turns omit system/document at the Seatline boundary. Stateless paths resend the scope and Ask history. A known lost session before output resends scope/history and reports the restart; ambiguous loss after output is saved as failure without replay. Changed context/settings require a new conversation before another turn is allocated. Request sizing happens before allocation/launch; a full conversation asks the reader to start another.

Deep read runs Structure, Logic and Thinking in sequence, saving every lens as its own version. It reuses the preceding session when available, otherwise sends independent full scopes. Cancellation or an invalid/partial lens stops the chain and preserves completed work. G shares D's controller, owner locks, worker session journalling and deletion maintenance. Chat writes atomically check that the document still exists, preventing deletion races from resurrecting data.

## Lenses and search

Prompt version `analysis-5` adds Themes, Meta-reading, Critique, Literature, Terms and Questions. Existing contracts supply standard record shapes and enums. Themes shows a codebook with linked codes/excerpts, tensions and memos; theoretical frames label the reading. Literature includes notes and citation roles. Terms retains original/translated forms; Questions exposes all four levels. Critique separates strengths and limitations. Terms/Questions default to the saved Quick tier. This implementation does not freeze model defaults or establish semantic quality.

Situate is selected explicitly and requires an advertised native-search capability. It maps to `kind:search` with an ephemeral session, including when the selected provider supports persistent analysis/chat. Both preview and execution enforce that Seatline restriction. No other G workflow enables tools; passage buttons clear a selected search/custom-lens operation before building their own request. Search-source events/results are normalized to credential-free HTTP(S) URLs. Every returned `cite.url` is compared against that turn's actual source evidence (including original evidence retained through repair/continuation). Matching links are marked `source_verified`; recalled/unmatched links are flagged and rendered without a hyperlink. A separate returned-source list remains available. Imported verified links must have matching source metadata. Source titles/snippets and all model content enter text nodes only.

## Second reader and reconciliation

Two different targets run Themes or Logic independently without shared sessions/output. Each result is saved before comparison. Themes use the union of theme references and associated excerpt paragraphs. Global descending Jaccard candidates are paired one-to-one at a 0.3 threshold with deterministic ties. Each pair shows evidence overlap and paragraph agreement; Cohen's kappa is reported only for at least 20 scope paragraphs and a nondegenerate expected agreement. Logic pairs compatible node kinds by paragraph overlap, then compares relations between mapped nodes, distinguishing support/attack contradictions. These measures align evidence, not semantic truth.

Reader pairs persist in `jobs` and reopen without a model call. The reader chooses findings to retain. Reconciliation namespaces both sides' IDs, validates dependencies against the same original scope, refuses dangling subsets, and saves a separate human-reconciled run with source-run lineage. There is no automatic synthesized agreement.

## Custom lenses, viewport and exports

Custom lenses store a name, instructions, standard record types and default tier in local storage. Definitions are validated, bounded and serialized under a Web Lock, and import/export as `sharh-lens` JSON. Dependent types require their referenced types. Each run embeds an immutable definition snapshot; its prompt identity includes that definition. The parser, canonical archive validator, views, repair and exports all use the snapshot, without a mutable global lens registry. Custom lenses cannot enable search.

The source HTML script reports visible paragraph numbers for its cached extraction; the panel verifies tab, frame, extension sender and version. The reader measures numbered HTML blocks and rendered PDF text items. Matching Structure/Logic cards and map nodes are highlighted, including comparison views; another extraction's view is cleared. Viewport updates make no model calls.

Markdown includes source/paragraph references and inert finding text. JSON uses the existing validated document archive, includes the selected extraction and available source file, and strips live runtime bindings. SVG maps clone native SVG with local computed styles; PNG is rasterized from that SVG, without a remote image/font request. The existing document importer restores the JSON records and source data.

## Verification and live gates

Run `npm run test:unit`, `npm run test:browser`, and `node scripts/verify-package.mjs`. G adds regression tests for session reuse/recovery, source proof, alignment against hand calculations, custom contracts and archive round trips, plus four packaged Chromium workflows. No test routes ship in the extension.

The six new lens corpus matrix is:

```sh
npm run evaluate -- --fixture --phase-two
npm run evaluate -- --phase-two --companion /path/to/seatline-companion --fake-provider /path/to/seatline-fake-provider --out test-results/g-broker-evaluation.json
```

Each runs 14 items × 2 providers × 6 lenses = 168 turns. Reports preserve raw first-attempt scoring and expert forms, and never mark Phase 2 accepted. Live evaluation omits the fixture/fake-provider flags; it requires the real companion, licensed natural texts, completed expert review and owner-machine G-13 acceptance. CI's fixtures measure mechanics only.

Review boundaries: Terms/Questions/custom tiers are resolved per analysis run; they do not change the shared picker used by Ask and Deep read. The partner picker shares initial discovery, opens without waiting for it, and has no tier/default-writing controls. Ask preserves the Analyze view/export selection and resends only completed answer pairs. Human reconciliation creates its completed run and records in one IndexedDB transaction. Source viewport observers cache paragraph/item bindings and publish only changed visible sets; re-extraction refreshes the initial report. Exported Markdown preserves the source URL fragment and labels paragraph numbers without promising a nonexistent source anchor.
