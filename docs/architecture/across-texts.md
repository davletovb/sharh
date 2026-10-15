# Across texts

Established: 2026-10-15. H-01–H-08 implementation; live quality and Phase 3 acceptance remain open. [Scope decision](../decisions/h-across-texts.md) · [Evidence](../evidence/2026-10-15-h-across-texts.md).

## Library and provenance

`src/across/library.mjs` saves whole documents or contiguous chapter/section scopes as extraction-bound library items. Collections contain ordered item snapshots; their order is independent of document order. Removing an item removes its memberships, not its source document. Deleting a collection deletes its derived reports, not the original sources. Document deletion atomically cascades through original/derived extraction versions, runs/records, chats, book jobs, glossary rows, memberships and durable Seatline maintenance intentions. Source-file bytes are not loaded merely to delete a graph.

Collection analysis creates a saved, inert derived document with a projection from each evidence paragraph to `{docId, version, n, itemId}`. Reviews/meta-syntheses project digest evidence; Compare projects the two selected source texts directly, subject to the same final request-size limit. It does not silently truncate an oversized source. Every projected reference opens the saved original extraction, not a similarly numbered paragraph in another text. JSON exports include original extraction dependencies. Markdown uses original item titles/paragraphs and preserves source URL fragments.

`finding` records have a kind, text, support note and references. `cell` records have an item ID, one of question/method/data/findings/concepts/stance, text and references belonging to that item. The parser and archive validator reject mismatched cell citations. Views compute the number of cited items rather than trusting a model-generated support count. Support strength remains an explicitly qualitative model judgment; there is no statistical pooling. Narrative notes carry source references.

## Jobs and digest reuse

`BookJobs` freezes the extraction, scope, chapter plan, language, focus/frame, glossary, prompt version and target order. The reader's selected chapter level partitions the scope, including any preceding material. One page-owned job holds the database-scoped background Web Lock; another job refuses immediately rather than queuing generations. Each turn carries background priority, and interactive work can use the companion concurrently. A page must stay open while work runs. Closing it releases its lock; reopening offers explicit Resume, never an automatic replay.

Completed digest runs are reused only for the same extraction, chapter scope, prompt identity and permitted exact target. A new model, prompt, language, budget, glossary or frame cannot inherit a loosely matched completed job. Progress saves each allocated run ID and each completed chapter. A partial chapter stops the job; explicit Resume continues that chapter with retained records before moving on. Failed/ambiguous turns are not silently switched or replayed. Deleted books/jobs cannot be resurrected by late progress writes. Oversized chapters refuse before allocation and require a narrower chapter plan.

Book-level Summary/Structure/Logic/Thinking send validated chapter digests, titles and global paragraph spans, not the full book. They retain original global paragraph references and use one synthesis target. Each digest keeps its producer; mixed-seat books and their synthesis inputs are labelled.

## Failover and glossary

Each task tier has an editable seat order and ask/automatic mode in local preferences. Foreground switching always asks. Automatic switching is restricted to background jobs after a terminal, known unavailable/sign-out/rate-limit failure with no returned output. Policy, isolation, invalid-option/request, oversize, timeout, disconnect and partial-output failures do not fail over. Unavailable/unaccepted candidates are skipped before launch. Every actual generation still uses the unchanged protected Seatline path. No cloud sign-in policy is bypassed.

Glossaries are book-owned editable entries with source terms, translations, notes, references, language tags and explicitly linked Latin/Cyrillic aliases. Completed Terms runs add new terms without overwriting an edited entry or alias. Applicable glossary snapshots are prompt data and part of prompt identity; source text never supplies instructions. Existing conversations and continuations keep their original snapshot. New conversations/runs see edits. Language-specific translations do not force an English choice into an Arabic or differently scripted output.

## Validation

```sh
node --test tests/across-texts.test.mjs
node scripts/verify-across-texts.mjs --fixture
node scripts/verify-across-texts.mjs --companion /path/to/seatline-companion --fake-provider /path/to/seatline-fake-provider
```

The H workflow matrix exercises two providers and six output-language/script tags: 132 turns per path, including chapter digests, four book lenses and three collection operations. Scripted and real pinned-broker stand-ins do not establish live semantic quality or multilingual usefulness. Packaged Chromium tests cover the controls, resume, source links, portable exports, glossary and foreground approval. Packaging runs after all matrices so the uploaded artifact retains the verified ZIP.

H-09 still requires the owner's live 300-page book, responsive passage actions, interruption/resume and cited synthesis, together with earlier live/expert gates.
