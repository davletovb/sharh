import {build} from 'esbuild';
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
await build({entryPoints:['src/prototypes/browser-entry.mjs'], bundle:true, format:'esm', target:'chrome124', outfile:'dist/prototype.mjs'});
await cp('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dist/pdf.worker.mjs');
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/standard_fonts', {recursive: true});
await cp('probes/extension', 'dist/probe', {recursive: true});
await mkdir('dist/probe/lib', {recursive: true});
await cp('scripts/lib/probe-client.mjs', 'dist/probe/lib/probe-client.mjs');
await cp('config/seatline-contract.json', 'dist/probe/contract.json');
await writeFile('dist/index.html', '<!doctype html><meta charset="utf-8"><title>Sharh extraction prototype</title><style>::highlight(sharh-reference){background:#ffd660;color:#16171c}</style><script type="module">import * as prototype from "./prototype.mjs"; window.prototype = prototype;</script>');

await cp('extension','dist/sharh',{recursive:true});
await build({entryPoints:['extension/worker.mjs','extension/ui/settings.mjs','extension/ui/panel.mjs','extension/ui/runs.mjs','extension/ui/client.mjs','extension/ui/panel-context.mjs','extension/lib/preferences.mjs','extension/lib/opening.mjs','extension/ui/reader.mjs','extension/ui/scope-picker.mjs','extension/ui/pdf-view.mjs'],bundle:true,format:'esm',target:'chrome124',outbase:'extension',outdir:'dist/sharh',outExtension:{'.js':'.mjs'}});
await build({entryPoints:['extension/content/reader.mjs'],bundle:true,format:'iife',target:'chrome124',outfile:'dist/sharh/content/reader.mjs'});
await cp('node_modules/pdfjs-dist/build/pdf.worker.mjs','dist/sharh/pdf.worker.mjs');
await cp('node_modules/pdfjs-dist/standard_fonts','dist/sharh/standard_fonts',{recursive:true});
await cp('node_modules/pdfjs-dist/wasm','dist/sharh/wasm',{recursive:true});
await cp('node_modules/pdfjs-dist/web/pdf_viewer.css','dist/sharh/pdf_viewer.css');
await mkdir('dist/sharh/licenses',{recursive:true});
await cp('node_modules/pdfjs-dist/LICENSE','dist/sharh/licenses/PDFjs.txt');
await cp('node_modules/@mozilla/readability/LICENSE.md','dist/sharh/licenses/Readability.md');
await cp('node_modules/@noble/hashes/LICENSE','dist/sharh/licenses/noble-hashes.txt');
// Browser acceptance imports the same production primitives without any test-only routes in the worker.
await build({entryPoints:['src/readers/browser-entry.mjs'],bundle:true,format:'esm',target:'chrome124',outfile:'dist/readers.mjs'});
await build({entryPoints:['src/documents/store.mjs'],bundle:true,format:'esm',target:'chrome124',outfile:'dist/sharh/documents.mjs'});
