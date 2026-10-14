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
```

`start` returns `{run, records}`. Each record is `{sequence, record, flags}`; retained records on a continuation also carry `retained: true`. `run` stores the extraction version, scope descriptor, monotonic version for that lens/scope, prompt/configuration identity, target, status, attempt metrics, time and optional locally owned session binding. A continuation is a new linked version, never an in-place rewrite of history. `mode: 'new'` always resends the document; `auto` uses a stored session only if the path still supports it. Running or already-continued runs cannot be continued concurrently.

`record`, `reset`, `repairing`, `repair_failed`, `session_reset` and `run` events augment path events. A text-only sink in `view.mjs` uses `textContent` exclusively. Observer exceptions do not invalidate data. The caller handles terminal failures; an error carries `runId` when available so validated partial records remain inspectable. Cancellation or disconnect does not silently replay a sent generation.

## Prompts and validation

- `contract.mjs` supplies field allowlists, per-lens types/enumerations, caps and the JSON output contract. Unknown fields, including model-supplied HTML or flags, are discarded. An unknown enum maps to `other` only where allowed.
- `prompts.mjs` supplies versioned rules, a JSON-serialized scope, and task/configuration data followed by the contract. Numbered blocks retain heading levels, physical/printed page labels, notes, selection spans, context and language. A continued session maps to null system/document at the Seatline boundary.
- `parser.mjs` accepts arbitrarily split string deltas and a final line without a newline. Fences/empty lines are counted and skipped; prose and malformed records are counted as drops. Input is bounded to 512 KiB, with a 64 KiB line bound. Oversized path requests are still refused by B before connecting.
- Strings are made well-formed, controls stripped, NFC normalized and capped by code points. Out-of-scope references are removed. Text-grounded records without references remain with `unanchored`; noncontiguous section spans retain explicit in-scope `refs`.
- `quotes.mjs` caches normalized source text. Quote/apostrophe/dash families, Uzbek apostrophe variants, whitespace, soft hyphens and NFC normalize before matching. Ellipsis segments must appear in order. Cross-paragraph matching joins only adjacent supplied paragraphs, and at least one matched segment must touch an actual cited paragraph. A quote found only in a neighbour fails. Failed quotes are removed and flagged.
- Duplicate IDs are renamed deterministically; references keep their first binding. ID-dependent records wait for completion. Dangling edges/dependants are dropped, dangling optional parents removed, and section parent cycles broken. Output after `end`, missing `end`, cancellation and output caps mark truncation.

Metrics distinguish physical lines, candidate record lines, new/retained valid records, drops/skips by reason, reference removals, quote checks, identifier repairs, truncation, timing and reported usage. `meta`/`end` and fences do not inflate the repair denominator. Retained records do not inflate the next turn's valid rate. Per-attempt metrics are retained; final run usage totals all attempts, including repair.

## Repair, continuation and storage

Below 80% valid candidate lines (or zero valid records), exactly one ephemeral repair is attempted. It receives the faulty output as JSON data and the output contract, not the source document. The repaired result passes the same validator. Repair records replace the visible/stored attempt only after the repair succeeds. A failed repair preserves the initial validated records and its failed attempt metadata. A repaired truncated result starts fresh on continuation, avoiding reuse of an unrepaired conversation.

Explicit continuation revalidates retained records and resolves new links against them. Session loss before any new output permits one announced scope reconstruction; a contextless answer after session loss is discarded rather than accepted. The resulting failed/truncated version can be explicitly continued as a new turn. Changing prompt versions refuses session reuse.

`RunRepository` allocates versions in one IndexedDB transaction. Streaming writes and final replacement require both the document and run still to exist; they cannot resurrect deleted data. Re-extraction's stale flag survives concurrent final writes. Existing C cascade deletion schedules deduplicated maintenance. The worker retries that durable outbox on activation and after reader deletion, using B's idle maintenance barriers. Failed intentions stay pending. Portable exports omit maintenance and all live session/cleanup bindings; v1 imports still work.

## Deterministic tests

`FakePath` implements the path interface with explicitly injected recorded JSON Lines/chunks, per-chunk timing, sessions, errors, usage and Unicode-safe output caps. It is never a production fallback. The test bundle and fake fixture scripts remain outside the packaged extension.

- `tests/analysis.test.mjs`: prompt placement, every record family, adversarial/chunked framing, normalization, identifiers and six language/script fixtures.
- `tests/analysis-engine.test.mjs`: streaming persistence, exact repair threshold, one-repair limit, failed repair isolation, both continuation modes, session loss, cancellation, deletion races, versions and maintenance retry.
- `tests/browser/analysis.test.mjs`: actual packaged Chromium/IndexedDB, a 200-record timed text sink, no HTML execution, repair replacement, sessionless continuation and reload.
- `scripts/verify-analysis-engine.mjs`: production engine and UI RPC through the pinned real broker, deterministic Claude CLI output, persistent continuation, metrics, cascade and actual `forget`/`cleanup`.

These establish deterministic integration behaviour, not live output quality, latency or subscription usage. The A-02/A-03/B-05 owner-machine gates remain open.
