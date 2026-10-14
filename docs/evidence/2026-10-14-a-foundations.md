# A foundation evidence

Date: 2026-10-14. Owner: Codex. Tested source: `27173456fd5eb51d8b6587bc26a60a9017c21ae0`; Seatline pin: `ba712f70eb4acd43b45b326bb4907feb9ded9c2f`.

Both jobs in [A foundations run 38501189839](https://github.com/davletovb/sharh/actions/runs/38501189839) passed. Environment: Ubuntu 24.04, Node 24, Playwright 1.62.1 / Chrome for Testing 151.0.7922.34, Rust 1.91.0. The linked reports are copied unchanged from that successful run's artifacts.

| Check | Evidence and result |
| --- | --- |
| Corpus and toolchain | 12 unit checks pass; the esbuild bundle succeeds; corpus regeneration leaves all committed fixture bytes unchanged |
| A-04 extraction and anchoring | [Extraction report](2026-10-14-extraction.json): all 14 fixtures match annotated block text, count, headings and reading order. HTML and PDF anchors resolve after reload and produce highlights; HTML quote fallback survives an unrelated DOM change. No fixture failures remain. |
| A-02 pinned authorization | [Real-companion stand-in report](2026-10-14-seatline-stand-in.json): native `ready` version 1, all four provider statuses, wrong-origin rejection, and the actual fixed-ID extension reaches `ready` in Chrome for Testing |
| A-02 diagnostics for B-05 | Chrome reports `Specified native messaging host not found.` for the absent host and `Access to the specified native messaging host is forbidden.` for a manifest without this origin. Both messages were observed through Chrome, not synthesized. |
| A-03 draft output | [Real-companion stand-in report](2026-10-14-seatline-stand-in.json): 56 runs (14 documents × 2 lenses × 2 stand-in CLIs) complete through `send_ready_with_policy`; 100% schema/parse rate and reference validity; every emitted quotation verifies; no dangling/duplicate IDs, parent cycles or canary output. First-record and completion timings are recorded per run. |
| A-03 isolated measurement | [Scripted-output report](2026-10-14-scripted-output.json): the same 56 cases pass with deliberately split chunks. Unit fixtures cover malformed/fenced/truncated output, invalid refs, forged quotes, graph defects, canaries, denied sign-ins and unsupported readiness; extraction failures retain earlier measurements. |
| A-05 scope and toolchain | [Decision and reproduction commands](../decisions/a-foundations.md) record the module/bundle approach, library choices, layout, scope defaults and unresolved live freeze |

These are synthetic fixture and stand-in measurements. They establish the mechanics of the probes and readers, not live provider quality, output compliance, latency, quota or performance on natural publications. No live Claude/Codex request was made. The owner's Chrome check and live Claude/Codex reports remain the A-02/A-03 gates; the [owner-machine commands](../decisions/a-foundations.md#owners-live-checks) are ready to run.

The local execution container forbids AF_UNIX sockets, so local Chrome stopped before loading a page (`socket() failed: Operation not permitted`). Browser and broker acceptance above was performed successfully on the GitHub runner. Initial CI failures exposed PDF.js API and isolated-profile native-host registration mistakes; those were corrected before the successful run. All current fixture failures are listed in the JSON reports (none remain). Prototype limits for unusual PDFs are recorded by the extractor and the decision document.
