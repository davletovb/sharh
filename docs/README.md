# Sharh documentation

Sharh is a browser reading assistant for web pages and PDFs. It shows how a text is built, how its argument moves and the model of thinking behind it, in many languages. Every finding is anchored to the paragraph it rests on. Models are reached first through the owner's [Seatline](https://github.com/davletovb/seatline) companion; an API-key path follows later.

Status: A/B foundations, C readers, D engine and E workspace are implemented. F adds versioned Phase 1/passage prompts and an original-output evaluation harness; live quality and owner acceptance remain open. Progress is recorded in the [implementation tracker](product/sharh-implementation-tracker.md).

## Reading order

| Document | Covers |
| --- | --- |
| [Phase 1 evaluation](architecture/phase-one-evaluation.md) | Production prompts, corpus/broker harness, automatic targets, expert forms and owner live commands |
| [F scope decision](decisions/f-phase-one-evaluation.md) | Accepted implementation dependencies and the live/owner acceptance boundary |
| [Reader evidence](evidence/2026-10-14-c-readers.md) | The C-slice readers, storage, opening controls and scopes |
| [Reader architecture](architecture/readers.md) | Production entry points, model/storage contracts, permission rules and limits |
| [Seatline path evidence](evidence/2026-10-14-b-seatline.md) | The B-slice extension, native client, path, policy, pacing and validation |
| [Foundation decision](decisions/a-foundations.md) | The A-slice toolchain, scope defaults, verification commands and remaining owner-machine gates |
| [Product framework](product/sharh-product-framework.md) | What Sharh is, its principles, the experience, the lens catalog, readers, languages, privacy, quality targets, phases and open decisions |
| [Implementation tracker](product/sharh-implementation-tracker.md) | The authoritative progress record: work items with dependencies, acceptance criteria, status, owners and evidence; upstream Seatline needs; the decision log |
| [Analysis pipeline](architecture/analysis-pipeline.md) | The document model and paragraph anchors, scopes, prompt assembly, the JSON Lines output contract, validation, long texts, second-reader alignment, storage and views |
| [Model paths](architecture/model-paths.md) | The path interface, task tiers and the model picker, failover, Second reader and Situate, the Seatline path and the later API path |
| [Seatline integration](architecture/seatline-integration.md) | Transport, setup and authorization, readiness and sign-in policy, turn mapping, capabilities, pacing, sessions, failures, client, testing and terms; pinned to the Seatline revision inspected |

## Conventions

- Each document starts with a version, the date it was established and a status.
- Statements about Seatline name the revision they were read from. Live behaviour (latency, output quality, limits) is claimed only with recorded evidence.
- Targets are things to measure, not promises.
- Sharh follows the conventions of [Lineleaf](https://github.com/davletovb/Lineleaf), the existing Seatline extension: one shared companion, reading-specific logic kept out of Seatline, and support established by testing.

- [Reading workspace](architecture/reading-workspace.md): E panel, model tiers, streaming maps, passage actions and saved versions.
- [E validation and screen-reader gate](evidence/2026-10-14-e-workspace.md).
