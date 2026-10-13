# Sharh documentation

Sharh is a browser reading assistant for web pages and PDFs. It shows how a text is built, how its argument moves and the model of thinking behind it, in many languages. Every finding is anchored to the paragraph it rests on. Models are reached first through the owner's [Seatline](https://github.com/davletovb/seatline) companion; an API-key path follows later.

Status: framework proposed on 2026-10-13. Nothing is implemented yet.

## Reading order

| Document | Covers |
| --- | --- |
| [Product framework](product/sharh-product-framework.md) | What Sharh is, its principles, the experience, the lens catalog, readers, languages, privacy, quality targets, phases and open decisions |
| [Analysis pipeline](architecture/analysis-pipeline.md) | The document model and paragraph anchors, scopes, prompt assembly, the JSON Lines output contract, validation, long texts, second-reader alignment, storage and views |
| [Model paths](architecture/model-paths.md) | The path interface, task tiers and the model picker, failover, Second reader and Situate, the Seatline path and the later API path |
| [Seatline integration](architecture/seatline-integration.md) | Transport, setup and authorization, readiness and sign-in policy, turn mapping, capabilities, pacing, sessions, failures, client, testing and terms; pinned to the Seatline revision inspected |

## Conventions

- Each document starts with a version, the date it was established and a status.
- Statements about Seatline name the revision they were read from. Live behaviour (latency, output quality, limits) is claimed only with recorded evidence.
- Targets are things to measure, not promises.
- Sharh follows the conventions of [Lineleaf](https://github.com/davletovb/Lineleaf), the existing Seatline extension: one shared companion, reading-specific logic kept out of Seatline, and support established by testing.
