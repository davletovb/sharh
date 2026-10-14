# Readers and document storage

Established: 2026-10-14. Owner: Codex. Slice C implementation; acceptance evidence is recorded in the [C report](../evidence/2026-10-14-c-readers.md).

## Entry points

The side panel's **Read current page** opens a reader tab attached to the source tab. A toolbar invocation grants `activeTab`; otherwise the reader asks for the source's optional host permission. Main article, whole-page and CSS-selector region extraction are available. The source stays open so references and selections can use its live DOM. Local HTML can be opened or dropped into the reader and is displayed as numbered text, never inserted as source HTML.

The reader also accepts PDF addresses, file-picker files and dropped files. PDF.js renders a canvas and a selectable text layer for each visible page, with nearby pages prepared lazily. Outline sections have physical page ranges; heading detection supplies sections when there is no outline. The reader shows printed labels alongside physical PDF page numbers. The chapter heading level can be changed in the scope picker. The numbered-text toggle exposes the extracted PDF blocks, including notes, and their paragraph buttons highlight the original text-item rectangles.

`.pdf` navigation opens Sharh when `pdfAutoOpen` is enabled (default) **and** the site has been allowed. No site permission is granted at installation. Settings can request all HTTP/HTTPS sites, or an individual PDF source can be allowed in the reader. Explicit toolbar/panel and context-menu opening work with the auto-open setting off; explicit PDF opening also accepts endpoints without a `.pdf` suffix. **Use Chrome's PDF viewer** disables auto-open persistently before navigating back, preventing a redirect loop after a service-worker restart. File URLs additionally require Chrome's **Allow access to file URLs** control. Dropped/picked files need no file-URL grant.

## Document contract

`src/documents/model.mjs` validates documents. IDs hash the source kind and identity. `reader-1` extraction versions hash identity, extractor version and normalized extraction content; PDF versions include a hash of the source bytes in the production reader. Titles, language, numbered blocks, section trees, page labels, warnings and extractor versions are stored with the document. Paragraph and page numbering are independent: ¶ starts at 1; physical PDF `page` starts at 0; `pageLabel` is the printed label.

HTML anchors contain a DOM path, normalized text-quote with prefix/suffix and normalized text-position offsets. Resolution verifies the exact quote and context, prefers a still-matching path and falls back to quote search after unrelated DOM changes. An ambiguous duplicate is left unresolved. Highlighting uses an adopted stylesheet and the CSS Custom Highlight registry; it adds no elements, attributes or wrappers to the source DOM. Re-extraction is explicit.

PDF anchors contain the physical page and original PDF.js text-item indices, separators and an exact normalized quote. Layout uses unrotated, crop-relative coordinates; highlight rectangles use the display viewport, including rotation. Footnotes follow their page's body blocks. Selection offsets are mapped through NFC, whitespace, soft-hyphen removal and conservative line-break dehyphenation, preserving the source selection even when a word crosses text items.

## IndexedDB

The `sharh` database is shared by extension pages. Settings remain in `chrome.storage.local`. Saving a new extraction is atomic and keeps earlier versions so existing runs retain their paragraph numbering and anchors; earlier runs are marked stale. There are no model calls in this storage layer.

| Store | Key | Purpose |
| --- | --- | --- |
| `docs` | `id` | Current document metadata |
| `extractions` | `[docId, version]` | Metadata for every retained extraction |
| `blocks` | `[docId, version, n]` | Text, kind, section and anchor |
| `sections` | `[docId, version, id]` | Section tree and spans |
| `sources` | `[docId, version]` | Picked HTML or PDF bytes for reopening offline |
| `runs` | `id` | Run metadata; D-05 supplies its final schema |
| `records` | `[runId, sequence]` | Validated run records |
| `chats` | `id` | Document chat state |
| `collections` | `id` | Ordered document/chapter memberships |
| `glossary` | `[bookId, term]` | Book terminology |
| `jobs` | `id` | Document job state |
| `maintenance` | `id` | Deduplicated Seatline forget/cleanup intentions |

Deletion removes all extraction versions, blocks, sections, source files, runs, records, chats, jobs and glossary rows in one transaction, and removes the document's collection memberships. Other documents survive. Related Seatline handles/groups become durable maintenance intentions in that transaction; dispatch/recovery belongs to D-05, not to C's reader actions.

Export takes one consistent readonly transaction and returns a `sharh-documents` version-1 JSON archive, excluding Chrome settings. PDF bytes are encoded as arrays of byte values. Import validates numbering, anchors, section trees, store keys and document/run relationships before writing. It adds rows atomically, accepts identical existing rows and aborts on a conflicting row. A rejected import leaves existing documents unchanged. It never silently replaces a document.

## Scopes and request limits

`buildScope` supports selection, section, chapter, physical PDF page range and document. It retains global paragraph numbers. Selection includes explicit selected character spans, two blocks before, one after, and the containing section's heading as context. The picker keeps a selection when focus moves to a control.

The scope serializer is JSON, keeping text, headings, page labels, notes and context/selection marks separate from instructions. `scopeSize` uses the same protected-frame builder as `SeatlinePath.run`, including JSON escaping, options, scheduling and sign-in policy. The displayed preview uses a default analysis turn until D/E supply the selected lens and target; its label states that limitation. The final actual request is independently checked before any connection/post. Exactly 1,000,000 bytes is allowed; an extra byte is refused. The token count is a labelled character-based estimate, not a model tokenizer.

Oversized scopes offer a selection, section, chapter or smaller page range. The book-job choice remains unavailable until H-02 exists. C introduces no analysis button, prompt execution or hidden generation.

## Limits

The annotated corpus establishes the tested layouts, not arbitrary PDF quality. OCR, DRM, overlapping/complex layouts and mixed-direction PDF reading order remain unsupported or require more evidence. Password-protected PDF errors are shown without a password UI. PDF fetches currently reject redirects; open the final source address. Arbitrary authenticated download workflows may need the file picker. Canvas-only pages and shadow-root readers remain outside the initial scope. These limits do not change the outstanding live A/B and Phase 1 gates.
