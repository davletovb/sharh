# A foundation slice: implementation decision

Established: 2026-10-14. Owner: Codex. Covers A-02 through A-06; A-01 remains the source audit at Seatline `ba712f70eb4acd43b45b326bb4907feb9ded9c2f`.

## Accepted slice and gates

The entire A slice is implemented together, as requested. The tracker decision permits A-04 to use A-06's corpus in the same change, and A-05 to record outstanding live gates while A-02/A-03 await the owner's machine. Passing deterministic checks is permission to develop B/C/D against these pinned foundations; it does not settle provider quality, latency or the final model defaults. Do not label a live gate DONE without its report.

The corpus contains 14 original CC0 synthetic fixtures, with all six language/script cases. The tests compare Readability/PDF.js output to annotated block text and ordering, reload serialized anchors and draw highlights over the cited paragraph. Synthetic fixtures test mechanics; naturally occurring texts must supplement them before F-08. Complex PDFs remain unsupported until additional fixtures establish their behaviour.

## Toolchain and layout

| Area | Decision |
| --- | --- |
| Modules and language | Native JavaScript ESM (`.mjs`), matching Lineleaf; no runtime framework in the A probes |
| Build | Node 24, npm lockfile, esbuild 0.28.2; local bundles only, no remote executable code; PDF.js worker/fonts copied locally |
| Web extraction | `@mozilla/readability` 0.6.0 on a clone, anchors mapped to the original DOM; CSS Custom Highlight API |
| PDF extraction | `pdfjs-dist` 6.4.299, PDF.js text-item indices and rectangles; PDF outline before detected headings |
| Markdown | Select `marked` plus DOMPurify for Ask; installation and rendering tests belong to G-01. No model output is rendered by these probes. Never use raw `innerHTML` for model text. |
| Graphs | Select `@dagrejs/dagre` for argument layout, `d3-hierarchy` for outlines and `d3-force` for concepts; bundle locally when E-03 implements views |
| Tests | Node's built-in test runner and Playwright 1.62.1; `pdf-lib` 1.17.1 generates deterministic original PDF fixtures; bundled `@noble/hashes` 2.0.1 supplies SHA-256 in insecure content-script contexts too |
| Companion | Build the audited revision with Rust 1.91.0 and its Cargo lockfile; no app-specific changes in Seatline |
| CI | Two jobs: corpus/prototype/metrics, and pinned real broker/bridge with stand-in CLIs plus actual Chromium native-host checks; upload JSON evidence even on failure |
| Code boundaries | `src/prototypes/`: extraction experiments; `scripts/lib/`: probe transport, draft prompts and metrics; `extension/`: A-02 diagnostic shell; `corpus/`: licensed fixtures; `tests/`: unit and browser acceptance; `config/`: pin and fixed ID |

The [review fixes](../evidence/2026-10-14-a-review-fixes.md) strengthen provenance, nested text, PDF layout/outline handling, compliance metrics and per-request overflow recovery. `foundation-2` versions invalidate earlier prototype extraction identities. General normalization keeps hard hyphens; only PDF line assembly attempts conservative de-hyphenation.

The prototype is not the production C reader, the metrics checker is not the tolerant D validator, and the probe transport is not the B native client/path. In particular, full nested PDF layouts, storage, production repairs, sessions, pacing, service-worker routing and all product views remain their existing tracker items. Promote proven primitives into those implementations with their acceptance tests.

## Phase 1 defaults

| Topic | Decision | Remaining gate |
| --- | --- | --- |
| Browser | Chrome desktop; development ID `npmhefooiolfpmhicinblelaideeejcm` fixed by the public manifest key | Owner's Chrome native-host checks; other browsers need S-01 |
| Sign-in | Subscription for Claude/Codex/Grok; Gemini cloud only after explicit opt-in, off by default; no plain-send fallback | Production B-04 policy and credential-change tests |
| Model defaults | Keep the proposed Quick Haiku/low, Analysis Opus/high, Book pass Sonnet/medium, Synthesis Opus/high as provisional configuration | A-03 live output, latency and plan-limit evidence blocks a final performance/quality freeze |
| Second reader | Claude and Codex provisionally | Independent live runs and G-08 alignment tests |
| PDF auto-open | On for `.pdf` addresses, with a setting to disable it | C-04 implements it |
| Distribution | Personal-development probe; distribution remains R-04 | Owner's distribution choice and that item's acceptance |

The JSON Lines schema remains a **draft** until real Claude/Codex measurements support it. The draft includes paragraph numbers for headings, so Structure can cite their spans; this resolves the earlier example that hid heading numbers. Every new extraction version keeps its paragraph numbers stable.

## Run the checks

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run verify
```

To reproduce CI's real-companion tests on Linux, check out Seatline at the contract revision, then:

```sh
cargo +1.91.0 build --locked --release -p seatline-companion -p seatline-tests --bins
# Back in the Sharh checkout:
node scripts/verify-companion.mjs --companion /path/to/seatline/target/release/seatline-companion --fake-provider /path/to/seatline/target/release/seatline-fake-provider
```

The script creates a temporary private Seatline registry and Chromium profile, authorizes the real Sharh development origin, checks `ready` and all four provider statuses, sends both draft lenses over all 14 extracted documents through the real broker, and captures Chrome's missing-host and forbidden-origin errors. Stand-in reports explicitly say they are not live providers. The registry, broker and profile are cleaned up after the run.

## Owner's live checks

Build and load `dist/probe` unpacked in Chrome at `chrome://extensions`. Install the pinned companion with `seatline-companion install` and authorize it:

```sh
seatline-companion authorize sharh codex,claude,gemini,grok chrome-extension://npmhefooiolfpmhicinblelaideeejcm/ --cache-title=Sharh
```

Open the extension's **Check authorization** button. Save its JSON result under `docs/evidence/` after reviewing it for private information. It must show this ID, `ready` version 1 and a status for every provider; missing/unavailable CLIs should report their actual status, not be replaced by a fake success. Keep real accounts and credentials out of commits.

For A-03, sign in to Claude/Codex with the accepted subscription mode and run the public corpus only:

```sh
npm run build
npm run probe:authorization -- --companion /absolute/path/to/seatline-companion --out test-results/owner-authorization.json
npm run probe:output -- --companion /absolute/path/to/seatline-companion --provider claude --out test-results/owner-claude.json
npm run probe:output -- --companion /absolute/path/to/seatline-companion --provider codex --out test-results/owner-codex.json
```

`--item ID` limits a diagnostic run; final A-03 evidence should include the full corpus. `--model ID` selects an explicit model. Each report stores the pin, model, prompt version and metrics, not raw document/model text. The command returns nonzero for incomplete output, invalid references, poor parse rate, failed quotes, graph integrity failures or canary output. A transport/provider failure produces a failed run with its partial metrics and does not discard earlier results. Copy reviewed public-corpus reports into `docs/evidence/`, record the installed CLI/model versions and the Chrome result, and only then close A-02/A-03. These runs consume the owner's provider plan; CI performs none of them.
