# Across texts

Established: 2026-10-15. H-01–H-08 implementation; live quality and Phase 3 acceptance remain open. [Scope decision](../decisions/h-across-texts.md) · [Evidence](../evidence/2026-10-15-h-across-texts.md).

## Library and provenance

`src/across/library.mjs` saves whole original documents or contiguous chapter/section scopes as extraction-bound library items. Derived reports remain in reading history and cannot themselves become library sources; imports reject nested derived source items too. Collections contain ordered item snapshots; their order is independent of document order. Removing an item removes its memberships, not its source document. Deleting a collection deletes its derived reports, not the original sources. Document deletion atomically cascades through original/derived extraction versions, runs/records, chats, book jobs, glossary rows, memberships and durable Seatline maintenance intentions. Source-file bytes are not loaded merely to delete a graph.

Collection analysis creates a saved, inert derived document with a projection from each evidence paragraph to `{docId, version, n, itemId}`. Reviews/meta-syntheses project digest evidence; Compare projects the two selected source texts directly, subject to the same final request-size limit. It does not silently truncate an oversized source. Every projected reference opens the saved original extraction, not a similarly numbered paragraph in another text. JSON exports include original extraction dependencies. Markdown uses original item titles/paragraphs and preserves source URL fragments.

Each digest record occupies one projected block, with its complete original paragraph list retained locally. The model receives projected block numbers, original paragraph numbers and one item-title table; source addresses, extraction hashes and repeated source metadata stay local. Reference controls and Markdown expand a projected citation back to its original paragraphs. Full imports union the singleton library's item IDs while preserving local items and still rejecting conflicting item content. Collection deletion immediately requests maintenance for its durably queued session cleanup.

`finding` records have a kind, text, support note and references. `cell` records have an item ID, one of question/method/data/findings/concepts/stance, text and references belonging to that item. The parser and archive validator reject mismatched cell citations. Views compute the number of cited items rather than trusting a model-generated support count. Support strength remains an explicitly qualitative model judgment; there is no statistical pooling. Narrative notes carry source references.

## Jobs and digest reuse

`BookJobs` freezes the extraction, scope, chapter plan, language, focus/frame, glossary, prompt version and target order. The reader's selected chapter level partitions the scope, including any preceding material. One page-owned job holds the database-scoped background Web Lock; another job refuses immediately rather than queuing generations. Each turn carries background priority, and interactive work can use the companion concurrently. A page must stay open while work runs. Closing it releases its lock; reopening offers explicit Resume, never an automatic replay.

Completed digest runs are reused only for the same extraction, chapter scope, prompt identity and permitted exact target. A new model, prompt, language, budget, glossary or frame cannot inherit a loosely matched completed job. Exact matching manifests are reused, including interrupted run bindings; creating a different manifest also checks interrupted runs for the same chapter before sending. Progress saves each allocated run ID and each completed chapter. A partial chapter stops the job; explicit Resume continues that chapter with retained records before moving on. An interrupted chapter with no durable output is ambiguous: ordinary Resume sends nothing, and the UI requires a separate run-bound Restart decision warning of possible repeated usage. Recovery does not offer generic Continue for zero-output owner interruptions. Explicit restarts retain their prior-run provenance. A free background lock lets list/load recover orphaned running jobs to paused; active owners cannot be displaced. Deleted books/jobs cannot be resurrected by late progress writes.

Creation preflights every chapter and splits oversized or headingless scopes at paragraph boundaries into request-sized parts, preserving global paragraph numbers. An individually unsendable paragraph refuses before creating a job. Run/resume reads digest history once, indexes completed candidates by scope/prompt/target, and computes cache identities without serializing source text again. Book synthesis explicitly permits the frozen extraction after re-extraction.

Book-level Summary/Structure/Logic/Thinking send validated chapter digests, titles and global paragraph spans, not the full book. They retain original global paragraph references and use one synthesis target. Each digest keeps its producer; mixed-seat books and their synthesis inputs are labelled.

## Failover and glossary

Each task tier has an editable seat order and ask/automatic mode in local preferences. Foreground switching always asks. Automatic switching is restricted to background jobs after a terminal, known unavailable/sign-out/rate-limit failure with no returned output. Policy, isolation, invalid-option/request, oversize, timeout, disconnect and partial-output failures do not fail over. Unavailable/unaccepted candidates are skipped before launch. Every actual generation still uses the unchanged protected Seatline path. No cloud sign-in policy is bypassed.

Candidate filtering also requires native search for Situate and support for the candidate's effort and service tier before offering or launching it. All identity checks share one canonical target key; object property order and UI labels cannot create false mixed-target labels.

Glossaries are book-owned editable entries with source terms, translations, notes, references, language tags and explicitly linked Latin/Cyrillic aliases. Completed runs add the terms a model returned as *suggested* entries, without overwriting an edited entry or alias. A suggestion is listed for the reader but is not sent to any prompt, so a model's wording never becomes a rule unreviewed. **Keep** (on a conversation card or in the Glossary page) makes it one of the reader's own entries, as does saving or editing an entry by hand. Entries stored before suggestions existed have no status and count as the reader's own. Applicable glossary snapshots are prompt data and part of prompt identity; source text never supplies instructions. Existing conversations and continuations keep their original snapshot. New conversations/runs see edits. Language-specific translations do not force an English choice into an Arabic or differently scripted output.

Automatic capture stops at 1,000 entries per book. Prompts select only entries whose term or alias occurs in the supplied scope, within a 32 KiB UTF-8 JSON budget; larger existing or manually edited glossaries remain usable. Entry limits count Unicode code points consistently with the output contract. Capture failures emit a warning event and cannot reject an already completed analysis. Glossary reads use the book index; ordinary lens/focus/budget changes do not reload the glossary or issue a duplicate preview.

## Validation

```sh
node --test tests/across-texts.test.mjs
node --test tests/h-review.test.mjs
node scripts/verify-across-texts.mjs --fixture
node scripts/verify-across-texts.mjs --companion /path/to/seatline-companion --fake-provider /path/to/seatline-fake-provider
```

The H workflow matrix exercises two providers and six output-language/script tags: 132 turns per path, including chapter digests, four book lenses and three collection operations. Scripted and real pinned-broker stand-ins do not establish live semantic quality or multilingual usefulness. Packaged Chromium tests cover the controls, resume, source links, portable exports, glossary and foreground approval. Packaging runs after all matrices so the uploaded artifact retains the verified ZIP.

H-09 still requires the owner's live 300-page book, responsive passage actions, interruption/resume and cited synthesis, together with earlier live/expert gates.
