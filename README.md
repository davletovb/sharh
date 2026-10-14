# Sharh

A browser reading assistant that helps you see how a text thinks, and check each reading against its paragraphs. Model access uses the shared [Seatline](https://github.com/davletovb/seatline) companion. [Product and architecture documentation](docs/README.md).

The A foundation slice provides a controlled multilingual corpus, Readability/PDF.js extraction prototypes, paragraph anchors, draft Structure/Logic output measurements and a fixed-ID Chrome native-authorization probe. The B slice adds the production MV3 scaffold, streaming Seatline path, sign-in policy, setup diagnostics and request pacing. Readers and lenses follow in C–F.

Node.js 24 is required:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run verify
```

Reports appear in `test-results/`. The [foundation decision](docs/decisions/a-foundations.md) records the scope, toolchain, remaining live gates and commands for the owner's machine. The [implementation tracker](docs/product/sharh-implementation-tracker.md) remains authoritative.

Build the fixed-ID extension with `npm run package`, then load `dist/sharh` unpacked in Chrome. Open its side panel or Settings → Seatline for the authorize command and a fresh provider check. `dist/sharh.zip` is the reproducible package. The separate A authorization probe remains at `dist/probe`.

[B-slice implementation and verification](docs/evidence/2026-10-14-b-seatline.md) records the production interfaces and the remaining owner-Chrome diagnostic gate.
