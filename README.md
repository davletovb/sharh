# Sharh

A browser reading assistant that helps you see how a text thinks, and check each reading against its paragraphs. Model access uses the shared [Seatline](https://github.com/davletovb/seatline) companion. [Product and architecture documentation](docs/README.md).

The A foundation slice provides a controlled multilingual corpus, Readability/PDF.js extraction prototypes, paragraph anchors, draft Structure/Logic output measurements and a fixed-ID Chrome native-authorization probe. The B slice adds the production MV3 scaffold, streaming Seatline path, sign-in policy, setup diagnostics and request pacing. The C slice adds anchored web/local HTML/PDF readers, versioned document storage, PDF opening controls and scope sizing. Analysis and lenses follow in D–F.

Node.js 24 is required:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run verify
```

Reports appear in `test-results/`. The [foundation decision](docs/decisions/a-foundations.md) records the scope, toolchain, remaining live gates and commands for the owner's machine. The [implementation tracker](docs/product/sharh-implementation-tracker.md) remains authoritative.

Build the fixed-ID extension with `npm run package`, then load `dist/sharh` unpacked in Chrome. Open its side panel or Settings → Seatline for the authorize command and a fresh provider check. `dist/sharh.zip` is the reproducible package. The separate A authorization probe remains at `dist/probe`.

[B-slice implementation and verification](docs/evidence/2026-10-14-b-seatline.md) records the production interfaces and the remaining owner-Chrome diagnostic gate.

Use **Read current page** from the side panel, or **Open PDF or local file** to pick/drop a file. PDF auto-open applies to allowed sites; file URLs additionally need Chrome’s file-access toggle. Reading and choosing a scope send no text to a model. [Reader setup, acceptance evidence and current limits](docs/evidence/2026-10-14-c-readers.md).
