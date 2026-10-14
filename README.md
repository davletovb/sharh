# Sharh

A browser reading assistant that helps you see how a text thinks, and check each reading against its paragraphs. Model access uses the shared [Seatline](https://github.com/davletovb/seatline) companion. [Product and architecture documentation](docs/README.md).

The A foundation slice provides a controlled multilingual corpus, Readability/PDF.js extraction prototypes, paragraph anchors, draft Structure/Logic output measurements and a fixed-ID Chrome native-authorization probe. It is a development harness; the product extension is built in milestone B onward.

Node.js 24 is required:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run verify
```

Reports appear in `test-results/`. The [foundation decision](docs/decisions/a-foundations.md) records the scope, toolchain, remaining live gates and commands for the owner's machine. The [implementation tracker](docs/product/sharh-implementation-tracker.md) remains authoritative.
