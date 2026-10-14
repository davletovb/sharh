# Analysis engine (D)

The path-neutral engine lives in `src/analysis/`; extension pages use `extension/ui/analysis.mjs` to reach the one worker-owned Seatline connection. E still owns the Analyze controls and specialized graph/card views. F still owns final lens wording and live prompt evaluation. Merely reading a document never starts analysis.

## Public entry points

```js
const {engine, maintenance} = createAnalysisEngine(store);
const result = await engine.start({
  doc, scope, target, lens: 'logic', language: 'en', budget: 24,
  focus: '', frame: '', persistent: false
}, {signal, onEvent});
const next = await engine.continue(result.run.id, {mode: 'auto', signal, onEvent});
const size = await engine.previewContinuation(result.run.id, {mode: 'new'});
```

`start` returns `{run, records}`. Each record is `{sequence, record, flags}`; retained records on a continuation also carry `retained: true`. `run` stores the extraction version, scope descriptor, monotonic version for that lens/scope, prompt/configuration identity, target, status, attempt metrics, time and locally owned session handles. A continuation is a new linked version, never an in-place rewrite of history. `mode: 'new'` resends the document and compact history; `auto` uses a reusable session only if the path still supports it. Session requests send a short history tail, and internal expanded section references are omitted from history prompts.

`preview` and `previewContinuation` measure the complete D rules/document/contract/history request, including the protected Seatline frame. Preflight happens before version allocation or generation; oversized continuations leave the previous version and its continuation link untouched. A path-side `TOO_LARGE` refusal is not offered for continuation.

`engine.ready`, `recover` and `list` recover ownerless running runs as interrupted. Each live run holds a Web Lock from before its storage transaction until execution ends. Closing or reloading its page releases the lock; recovery never steals a live owner's turn. An interrupted continuation retains its saved records and can create the next linked version. Storage failures attempt to mark interruption, and later recovery can finish that transition after the storage becomes usable.

`record`, `reset`, `repairing`, `repair_failed`, `session_reset` and `run` events augment path events. There is exactly one terminal `run` event; a recorded cancellation is not subsequently labelled failed. A text-only sink in `view.mjs` uses `textContent` exclusively. Observer exceptions do not invalidate data. The caller handles terminal failures; an error carries `runId` when available so validated partial records remain inspectable. Cancellation or disconnect does not silently replay a sent generation.

## Prompts and validation

- `contract.mjs` supplies field allowlists, per-lens types/enumerations, caps and the JSON output contract. Optional null and blank string fields are omitted; required fields still validate. Unknown fields, including model-supplied HTML or flags, are discarded. An unknown enum maps to `other` only where allowed.
- `prompts.mjs` supplies versioned rules, a JSON-serialized scope, and task/configuration data followed by the contract. Numbered blocks retain heading levels, physical/printed page labels, notes, selection spans, context and language. A continued session maps to null system/document at the Seatline boundary.
- `parser.mjs` accepts arbitrarily split string deltas and a final line without a newline. Fences/empty lines are counted and skipped; prose and malformed records are counted as drops. Input is bounded to 512 KiB, with a 64 KiB line bound. Oversized path requests are still refused by B before connecting.
- Strings are made well-formed, controls stripped, NFC normalized and capped by code points. Out-of-scope references are removed. Text-grounded records without references remain with `unanchored`; noncontiguous section spans retain explicit in-scope `refs`.
- `quotes.mjs` caches normalized source text. Quote/apostrophe/dash families, Uzbek apostrophe variants, whitespace, soft hyphens and NFC normalize before matching. Unicode, ASCII and spaced ellipses normalize to ordered omission segments. Cross-paragraph matching joins only adjacent supplied paragraphs, and at least one matched segment must touch an actual cited paragraph. A quote found only in a neighbour fails. Failed quotes are removed and flagged.
- Duplicate IDs are renamed deterministically; references keep their first binding. ID-dependent records wait for completion. Dangling edges/dependants are dropped, dangling optional parents removed, and section parent cycles broken. Missing `end`, cancellation and output caps mark truncation. Trailing content after `end` is skipped and counted without affecting validity or completion. A clean end-only response is a valid empty completion, including on continuation.
- Retained canonical records are cloned directly, preserving their exact fields, IDs and flags without restoring sentinels or normalizing them again. An invalid history fails atomically before emitting any seeded records. Portable imports validate canonical shapes/links/references and verify retained quotes against the saved extraction at the trust boundary.

Metrics distinguish physical lines, candidate record lines, new/retained valid records, drops/skips by reason, reference removals, quote checks, identifier repairs, truncation, timing and reported usage. `meta`/`end` and fences do not inflate the repair denominator. A clean end-only output has valid rate 1; blank or malformed output does not. Retained records do not inflate the next turn's valid rate. Per-attempt metrics remain immutable through late cancellation; final run usage totals all attempts, including repair.

## Repair, continuation and storage

Below 80% valid candidate lines (or no valid records without a clean empty completion), exactly one ephemeral repair is attempted. It receives only the current attempt's faulty output as JSON data and the output contract, not the source document or retained history. The repair parser seeds retained records locally, so repairing a continuation cannot lose immutable history to the model's 32 KiB output cap. Replacement requires transport success, acceptable validation, and **at least as many valid new records as the original attempt**. A failed, still-invalid or smaller repair preserves the initial useful records and records its rejection reason. Repair cannot clear a path-reported output cap: the run remains truncated and can continue. The original session remains owned for cleanup but is marked nonreusable after repair.

Explicit continuation seeds canonical history and resolves new links against it. Session loss before any output permits one announced scope reconstruction, even if a provider then attempts to stream a contextless answer. That contextless output is discarded and the attempt is cancelled. The decision uses the state at the first loss event. Loss after useful output does not replay the turn; its failed/truncated version can be explicitly continued with the scope. Changing prompt versions refuses session reuse.

`RunRepository` allocates versions in one IndexedDB transaction. Streaming appends check only the run's key and write records, without rewriting scope/configuration metadata or locking `docs`. The cascade shares the runs/records stores, so appends cannot resurrect deleted data. Metadata/final writes preserve re-extraction's stale flag. The worker journals session handles independently of the page. A handle arriving after deletion creates durable forget/cleanup intentions; repair never erases cleanup ownership. Portable exports strip both reusable sessions and all owned handle lists.

Maintenance intentions have revision tokens. A completed dispatch acknowledges only its own revision, so re-queued cleanup survives an older completion. Requests during an active drain schedule another pass, and superseded intentions also trigger a fresh pass. Failures remain pending; malformed intentions are discarded with a diagnostic. Providers come from the pinned contract and all storage helpers use the same non-null transaction-abort error. Dispatch still uses B's idle barriers and one worker-owned native connection. Legacy portable archives remain importable.

## Deterministic tests

`FakePath` implements the path interface with explicitly injected recorded JSON Lines/chunks, per-chunk timing, sessions, errors, usage and Unicode-safe output caps. It is never a production fallback. The test bundle and fake fixture scripts remain outside the packaged extension.

- `tests/analysis.test.mjs`: prompt placement, every record family, adversarial/chunked framing, normalization, identifiers and six language/script fixtures.
- `tests/analysis-engine.test.mjs`: streaming persistence, exact repair threshold, one-repair limit, failed repair isolation, both continuation modes, session loss, cancellation, deletion races, versions and maintenance retry.
- `tests/d-review-regressions.test.mjs`: all 15 additional review findings, including canonical import trust, owner recovery/protection, full request sizing, capped smaller repairs, late sessions, terminal events and revision-safe outbox draining.
- `tests/browser/analysis.test.mjs`: actual packaged Chromium/IndexedDB, a 200-record timed text sink, no HTML execution, repair replacement, sessionless continuation and reload.
- `tests/browser/d-review.test.mjs`: two real extension pages prove a live owner cannot be stolen and a closed continuation page recovers its complete saved history.
- `scripts/verify-analysis-engine.mjs`: production engine and UI RPC through the pinned real broker, deterministic Claude CLI output, persistent continuation, metrics, cascade, actual `forget`/`cleanup`, and worker-owned session journaling after its caller closes.

These establish deterministic integration behaviour, not live output quality, latency or subscription usage. The A-02/A-03/B-05 owner-machine gates remain open.
