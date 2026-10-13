# Sharh — Product Framework

Version: 0.1  
Established: 2026-10-13  
Status: Proposed. Nothing is implemented yet. Phases and acceptance checks are in [Phases and acceptance](#phases-and-acceptance).

## What Sharh is

Sharh is a reading assistant for the browser. It reads web pages and PDFs and helps a reader understand a passage, a chapter, a whole book or a set of texts. It covers what a text says, how it is built, how its argument moves and the model of thinking behind it. It works across languages: the text can be in one language and the analysis in another.

The name comes from *sharh* (شرح), the classical commentary genre whose purpose is to unpack a text's terms, structure and reasoning.

Product promise: **See how a text thinks, and check every reading against the page.**

Sharh is built around three ideas:

1. **Anchored analysis.** Every finding cites the paragraphs it rests on, so an AI reading can be checked against the text instead of taken on trust.
2. **Architecture as well as content.** Structure, logical flow and the model of thinking get first-class views. Summaries are one lens among many.
3. **The reader's own model seats.** Models are reached through the reader's own signed-in CLIs and their subscriptions via [Seatline](https://github.com/davletovb/seatline). Several providers can be compared on the same text. An API-key path follows later ([model paths](../architecture/model-paths.md)).

Sharh does not promise that its readings are correct. They are readings to check, and the interface is built for checking. It also does not promise unlimited use, since every subscription has limits, or clean extraction from every site and PDF.

## Who it is for

- Researchers and graduate students reading monographs, articles and archival material, often across languages.
- Students working through difficult chapters.
- Anyone reading in a second language who wants the structure of a text as well as its words.

Jobs it should do well:

1. **Before reading:** say what a chapter is about, the question it answers, what to watch for and which terms it needs.
2. **While reading:** explain or translate a passage in context, and show where the reader is in the argument.
3. **After reading:** map the structure and the argument, surface assumptions and check comprehension.
4. **Research work:**
   - code themes with excerpts;
   - place a text in its debate;
   - compare texts;
   - draft a literature review from a reading list.

## Product principles

1. **Anchor everything.**
   - Paragraphs are numbered (¶).
   - Every summary point, claim, map node, code and theme cites the ¶ it rests on.
   - Clicking a reference scrolls to that paragraph and highlights it, on the live page or in the PDF reader.
2. **Separate the text from the reading.**
   - Each interpretive item is marked *stated* (the text says it) or *inferred* (the model reconstructs it).
   - Assumptions, worldview and blind spots are inferred by nature and are always labelled as such.
3. **Verify quotations.** Words shown as the author's must match the source exactly, after normalizing whitespace and punctuation variants. A quotation that cannot be found is flagged or removed, never shown as if verified.
4. **Treat the text as data.**
   - Page and PDF text never directs what a model does.
   - Analysis turns run with tools off.
   - The document is delimited, and the instructions say it contains no instructions.
5. **The reader decides what is sent.** Nothing goes to a model until the reader runs something. The scope and its size are shown before every run.
6. **Local first.**
   - The library, analyses, chats, glossary and settings stay in the browser.
   - Sharh has no server, no account and no telemetry.
7. **One set of lenses on every path.** Prompts, the output format and the views do not depend on which model path runs them.
8. **Support is earned by testing.** A provider, a kind of site or a class of PDF counts as supported after it is tested, not because it should work.

## Scope

| Capability | First usable release (Phase 1) | Later |
| --- | --- | --- |
| Sources | Web pages (main text), local HTML, PDFs with a text layer, with or without an outline | EPUB, scanned PDFs (OCR) |
| Passage help | Explain, Translate, Logic, Define on a selection | Custom passage actions |
| Chapter lenses | Summary (with synopsis), Structure, Logic, Thinking | Themes, Meta-reading, Critique, Literature, Terms, Questions, Situate, custom lenses |
| Interaction | Scope picker, streaming views, jump to ¶, saved runs | Ask, Deep read, You-are-here, Second reader, exports, full-tab studio |
| Across texts | — | Library, collections, literature review, meta-synthesis, compare, whole-book jobs |
| Languages | Any source language the model reads; output language chosen per run | Running glossary per book; interface in Uzbek and Russian |
| Model paths | Seatline: Claude Code, Codex, Gemini through Antigravity, Grok | API keys: Anthropic, OpenAI-compatible endpoints, local models |
| Browser | Chrome desktop | Edge, Brave and Arc once Seatline registers its native host there; Firefox as a separate port |

## Experience

### Passage

Selecting text on a page or in the PDF reader shows a small toolbar with four actions: Explain, Translate, Logic and Define, plus *Ask about this*. Results open in the side panel.

Each request carries the selection and its surroundings: the section heading and the neighbouring paragraphs (by default two before and one after). Explanations are therefore about this text, not about the words in isolation.

- **Explain:** a plain-language explanation at a depth the reader chooses, with key terms glossed.
- **Translate:** a faithful translation into the output language. It adds notes on hard terms, idioms, register and culturally loaded words, and keeps original terms beside their translations.
- **Logic:** what the author is doing here (claim, evidence, concession, objection, definition, example or transition) and how the passage connects to what comes before and after.
- **Define:** what a term means in this text compared with its general meaning, citing the ¶ where the text introduces it.

### Chapter

The side panel header shows the document, the scope with its size, the output language and the model in use.

```
+-- Sharh -------------------------- [EN v] [Claude · Opus v] -+
| Chapter 3 — Print and the Making of Publics                  |
| Scope: Chapter 3, pp. 45–78  v                 ≈38k tokens   |
|--------------------------------------------------------------|
|  Analyze  |  Ask  |  Library                                 |
|--------------------------------------------------------------|
| Summary  Structure  Logic  Thinking  Themes  …  [Deep read]  |
|--------------------------------------------------------------|
| Logic — argument map (assembling…)                     [<>]  |
|   premise ¶4  --supports-->  claim ¶12                       |
|   objection ¶19  --attacks-->  claim ¶12                     |
|   gap: unstated premise between ¶12 and ¶15                  |
+--------------------------------------------------------------+
```

- **Scopes:** selection, section, chapter, page range (PDF) or the whole document.
  - Chapter boundaries come from the PDF outline or from the page's headings.
  - Where neither exists, the reader picks a range.
- **Runs:**
  - A lens runs on the scope. Results stream in, and maps assemble as records arrive.
  - Each run is saved with its scope, model, settings and date, so reopening a document shows earlier runs at no cost.
  - Running a lens again creates a new version, and versions can be compared.
- **Studio:** the side panel is narrow, so any view can expand into a full tab.

### Ask

Ask is a chat grounded in the current scope.

- Answers cite ¶ and say plainly when the text does not address the question.
- Providers that keep sessions through Seatline (Claude and Codex at the inspected revision) receive the scope once.
- For the others, each question resends it.

### Deep read

One action runs Structure, Logic and Thinking in sequence on the same scope. On providers with sessions, the later lenses continue the session that already holds the chapter, so they can build on earlier results. For example, the Logic lens can use the sections Structure found.

### You-are-here

As the reader scrolls, the structure map highlights the section and the argument nodes for the paragraphs in view.

### Second reader

Runs one lens independently on two providers (Claude and Codex by default) and shows where they agree and where they diverge.

- **Themes:**
  - Themes are matched by the paragraphs they cite, and agreement is shown per theme with the excerpts each reader used.
  - Disagreements are listed for the reader to settle, and the reconciled codebook is saved.
  - This mirrors two-coder qualitative coding.
- **Logic:** claims and links found by both readers, by only one, or contradicted.

Divergence is information. It often marks where the text is genuinely ambiguous or where a reading leans on inference.

### Situate this text

An opt-in lens that uses the provider's own web search. It finds reviews, responses, works that cite the text, and context on the author and the debate.

- Links come only from the search results the provider returns. The lens never presents a citation the model recalled from memory.
- It is available on providers with web search (Claude, Codex and Gemini at the inspected Seatline revision).
- Search queries are derived from the text, so the lens runs only when asked.

### Custom lenses

A reader can define a lens with:

- a name;
- instructions;
- the record types it may produce, chosen from the standard set;
- a default tier.

Example: *Read this as information infrastructure. What does the text treat as standards, registries or classification systems, and who maintains them?*

Custom lenses use the same output contract, so they get the same views, validation and exports. They are stored locally and can be exported and shared as files.

### Across texts

Documents, or single chapters, are saved to a local library and grouped into collections, such as the reading list for one thesis chapter.

- **Literature review:** themes, agreements, debates, methods used and gaps across a collection. It produces a draft narrative review that cites library items and ¶.
- **Meta-synthesis:**
  - A matrix of texts against criteria: question, method, data, findings, concepts and stance.
  - Each cross-text finding carries a note on how many texts support it and how strongly.
  - The synthesis is qualitative, with no statistical pooling.
- **Compare:**
  - Two texts side by side: where they agree and disagree, and concepts they share but use differently.
  - It also covers what each text would say about the other.
- **Whole-book jobs:**
  - A book is processed chapter by chapter in the background, and the job can resume after an interruption.
  - Book-level lenses then run on the chapter digests ([analysis pipeline](../architecture/analysis-pipeline.md#long-texts)).

### Exports

- Markdown with ¶ references and a link to the source. It works in Obsidian, Notion and Zotero notes.
- SVG and PNG for maps.
- JSON for re-import.
- Any single item can be copied together with its reference.

## Lens catalog

| Lens | Question it answers | Shown as | Default tier | Phase |
| --- | --- | --- | --- | --- |
| Summary | What does it say? One line, an abstract, section by section, and a *before you read* brief (question, what to watch for, needed terms). The synopsis traces the arc from the opening problem to where it lands. | Cards, arc timeline | Analysis | 1 |
| Structure | How is it built, and what does each part do? Parts are labelled by function: context, definition, claim, evidence, objection, rebuttal, synthesis and so on. | Outline, mind map | Analysis | 1 |
| Logic | How does the argument move, and where are its gaps? Premises, evidence, inferences, objections and conclusions, linked by supports, attacks and qualifies. Also a step-by-step narration and gaps such as unstated premises, leaps, circularity or equivocation. | Argument graph, steps, gap list | Analysis | 1 |
| Thinking | What model of thinking produces this text? The question behind the question, what counts as evidence, the mode of reasoning, unargued assumptions, worldview, key concepts and their relations, lineage, normative commitments, blind spots, and what would change the author's mind. | Concept map, causal chain, facet cards | Analysis | 1 |
| Themes | Which themes, codes and tensions run through it? Codes come with excerpts and analytic memos. An optional theoretical frame (e.g. Bourdieu, Foucault, postcolonial theory, infrastructure studies) labels the reading as one made through that frame. | Codebook, excerpts, tensions | Analysis | 2 |
| Meta-reading | What kind of text is this, and where does it stand? Genre, audience, purpose, the author's position, historical context, framing and silences. | Facet cards | Analysis | 2 |
| Critique | How strong is it? Strengths, weak points, quality of evidence and counterarguments. | Two-column cards | Analysis | 2 |
| Literature | Whom does it cite and how (foundation, foil, method, evidence or context)? Which debate does it enter, and what contribution does it claim? | Citation table | Analysis | 2 |
| Terms | Which terms does the reader need? Each in the original language with a translation and its meaning in this text. | Glossary | Quick | 2 |
| Questions | Can the reader explain it back? Questions from comprehension to debate, each tied to ¶. | Question list | Quick | 2 |
| Situate | Where does it sit in the wider conversation? Uses web search and returns linked sources. | Linked sources | Analysis | 2 |
| Literature review | What do the texts in a collection say together? | Narrative, theme matrix | Synthesis | 3 |
| Meta-synthesis | Which findings hold across texts, and how strongly? | Matrix, agreement | Synthesis | 3 |
| Compare | How do two texts relate? | Side by side | Synthesis | 3 |

The record types each lens produces are defined in the [output contract](../architecture/analysis-pipeline.md#output-contract-json-lines).

## Readers

### Web pages

- **Extraction:**
  - The main text is extracted with Mozilla Readability, the engine behind Firefox Reader View. Navigation, advertising and comments are left out.
  - When extraction misses something, the reader can switch to whole-page mode or select a region.
- **Anchors:**
  - Paragraph numbers are assigned to the extracted blocks and mapped back to the live page, so references jump to and highlight the real paragraphs.
  - Highlights use the CSS Custom Highlight API and do not modify the page.
- **Sections:** headings become section scopes, which makes long single-page books usable chapter by chapter.
- **Local HTML:** files open in place when the extension is allowed to access file URLs, or they can be dropped into Sharh's reader.

### PDFs

- **Own reader:** Chrome's built-in PDF viewer does not expose its text or selection to extensions, so Sharh has its own reader built on PDF.js, the engine behind Firefox's PDF viewer.
- **Opening:**
  - Links and tabs whose address ends in `.pdf` open in Sharh's reader automatically. This setting is on by default and can be turned off.
  - Other PDFs open from the toolbar button or the context menu.
  - Local files open by drag and drop, or automatically when file-URL access is allowed.
- **Chapters:**
  - The PDF outline (bookmarks) supplies chapter scopes with page ranges.
  - Without an outline, headings are detected from font size and position.
  - A page range can always be chosen by hand.
- **Clean-up:**
  - Words hyphenated across line breaks are rejoined.
  - Running headers, footers and page numbers are removed.
  - Multi-column pages are read in column order.
  - Footnotes are detected and kept as notes, which feeds the Literature lens.
- **References:** combine ¶ with the printed page label where one exists (e.g. ¶41, p. 47), so citations match the book.
- **Not in the first release:** scanned PDFs without a text layer (they need OCR) and DRM-protected files.

### Not supported initially

- Readers that draw text on a canvas, such as Google Docs or Kindle Cloud Reader, because they do not expose their text to extensions.
- EPUB, which comes later.

## Languages

- **Source text:** any language the chosen model reads. The evaluation corpus covers English, Russian, Uzbek (Latin and Cyrillic), Turkish and Arabic.
- **Output language:** chosen per run in the panel header. A Russian chapter can be analysed in Uzbek.
- **Key terms:** they keep their original form beside the translation, for example *ijtihod (independent reasoning)*.
- **Translation:** Translate favours meaning over fluency. It notes untranslatable terms, idioms and register.
- **Glossary:** a running glossary per book keeps term choices consistent across chapters and runs. The reader can edit its entries.
- **Uzbek:**
  - Quotation checks and search treat the variants of the oʻ/gʻ apostrophe (ʻ ’ ' `) as equivalent.
  - The glossary can link a term's Latin and Cyrillic spellings.
- **Right-to-left text:** Arabic and Persian render correctly in the reader and the panel, and quotations in a mixed direction keep their direction.
- **Interface language:** English first, with Uzbek and Russian later.

## Model paths

Summarized here; details are in [model paths](../architecture/model-paths.md) and [Seatline integration](../architecture/seatline-integration.md).

- **Seatline first:** Claude Code, Codex, Gemini through Antigravity, and Grok, reached through the reader's own installed and signed-in tools and the shared Seatline companion.
- **API keys later:** Anthropic and OpenAI-compatible endpoints, including local models through Ollama or LM Studio. They plug into the same interface, and nothing above the path layer changes.
- **One model picker** across paths:
  - four task tiers (Quick, Analysis, Book pass and Synthesis), each with its own model and effort setting;
  - a failover order for when a seat reaches its usage limit;
  - a provider pair for Second reader.

## Look and feel

- **Palette:**
  - The default theme has a dark ink background with gold accents.
  - Lapis and turquoise from Timurid tilework are the categorical colours of the maps.
  - An eight-point star is the mark.
  - A light parchment theme is the alternative, and the system setting decides by default.
- **Typography:** a serif with complete Uzbek Latin (oʻ, gʻ) and Cyrillic coverage for reading (for example Literata), and a monospace for references. The measure and line height suit long reading.
- **Maps:**
  - Pan, zoom and collapse.
  - Selecting a node shows its paragraph.
  - Every view expands into a full tab.
- **Accessibility:**
  - Contrast meets WCAG AA in both themes, focus is always visible and reduced motion is respected.
  - Every map has a text outline equivalent for keyboard and screen-reader use.

## Privacy and security

- **What leaves the machine:**
  - Only the text of the scope the reader runs, together with the lens instructions, goes to the provider of the chosen path.
  - On the Seatline path it goes through the reader's own CLI to that provider, under the reader's own account with it.
- **What Sharh keeps:**
  - Extracted text, analyses, chats, the library, the glossary and settings are kept in the browser's extension storage.
  - There is no Sharh server, no sync and no telemetry.
  - Everything can be exported and deleted.
- **Untrusted text:**
  - Analysis turns run with tools off (`tools: "none"` on Seatline), so instructions hidden in a page can at most distort an answer. They can never make a provider act.
  - Documents are delimited in the prompt, and model output is rendered as text, never as HTML.
- **Permissions (proposed):**
  - `sidePanel`, `storage`, `unlimitedStorage`, `nativeMessaging`, `contextMenus`, `scripting` and `activeTab`.
  - Site access is optional, requested when the reader enables the selection toolbar on a site or on all sites.
  - File-URL access is optional.
  - Incognito is off by default.
- **Deletion:** deleting a chat, a deep read or a document also asks Seatline to forget the related sessions and clean up after them.

## Quality and evaluation

Quality is checked in two ways.

- **Automatic checks** run on every run:
  - parse rate (valid records out of all lines);
  - validity of references (they exist inside the scope);
  - quotation verification;
  - structural integrity (no dangling identifiers);
  - coverage (the share of headings that appear in Structure);
  - completion (an `end` record arrived);
  - time to the first record and to completion.
- **Expert review** on a fixed corpus rates each lens and provider for:
  - faithfulness (nothing the text does not support, and inferences marked as such);
  - structural accuracy;
  - argument accuracy;
  - insight (Thinking and Meta-reading should go beyond paraphrase);
  - usefulness for the job.

The **corpus** has chapters and articles in English, Russian, Uzbek (Latin and Cyrillic), Turkish and Arabic.

- HTML items include a long single-page book and a multi-page article.
- PDF items include a book with an outline, one without, a two-column article and a footnote-heavy monograph.

**Targets to measure** (not promises):

- at least 98% of references valid;
- every displayed quotation verified, with unverified ones flagged;
- a parse rate of at least 95% on Claude and Codex;
- Structure coverage of at least 90% of headings.

Latency targets will be set after live measurement.

## Phases and acceptance

### Phase 1 — Chapter X-ray

- **Foundation:**
  - the model-path interface;
  - the Seatline path, with a native client, a setup screen with the authorize command and diagnostics, readiness and sign-in policy, and pacing;
  - the document model and storage;
  - a test harness using the real Seatline companion with stand-in providers.
- **Readers:** web pages and local HTML; the PDF reader with outline chapters, clean-up and page labels.
- **Panel:**
  - a scope picker with size;
  - a model picker with task tiers;
  - streaming views;
  - jump-to-¶ highlights;
  - saved runs.
- **Passage toolbar:** Explain, Translate, Logic and Define.
- **Lenses:** Summary (with synopsis), Structure, Logic and Thinking.

Acceptance:

- On the corpus, every Phase 1 lens completes on Claude and Codex through a real companion on the owner's machine, and the automatic targets are met.
- References jump to the right place in the HTML and PDF fixtures.
- Setup names each failure state correctly.
- No request exceeds Seatline's frame limit; a scope that is too large leads to a guided split.

### Phase 2 — Scholar's toolkit

- **Lenses:** Themes, Meta-reading, Critique, Literature, Terms, Questions and Situate, plus custom lenses.
- **Features:** Ask, Deep read, You-are-here, Second reader, exports and the full-tab studio.

Acceptance:

- Second reader alignment agrees with hand-coded fixtures.
- Situate shows only links that came from search results.
- Exports survive a round trip.

### Phase 3 — Across texts

- **Library:** collections, literature review, meta-synthesis and compare.
- **Whole-book jobs:** chapter digests, resume and failover.
- **Glossary:** a running glossary per book.

Acceptance:

- A 300-page book completes as a background job while passage actions stay responsive.
- An interrupted job resumes without redoing finished chapters.
- Syntheses cite library items and ¶.

### Phase 4 — API path

- Anthropic and OpenAI-compatible endpoints, including local models.
- Key storage.
- Schema-constrained output and explicit prompt caching where the provider offers them.
- Cost estimates.

Acceptance: every lens runs unchanged on the API path and passes the same validation.

### Later candidates

- EPUB.
- OCR for scanned PDFs.
- An interface in Uzbek and Russian.
- Edge, Brave and Arc, after Seatline registers its native host for them.
- Firefox.
- Zotero integration.

## Out of scope

- Statistical meta-analysis that pools effect sizes. Sharh's meta-synthesis is qualitative.
- Writing and editing assistance, which is Lineleaf's domain.
- Accounts, cloud sync, a hosted backend and team features.
- Mobile browsers.
- DRM-protected or canvas-only content.

## Decisions and open questions

| Topic | Default | Status |
| --- | --- | --- |
| Name | Sharh | Settled |
| Browser | Chrome desktop | Open. Seatline registers its native host for Google Chrome only. Other Chromium browsers need that registration in Seatline's installer. |
| Sign-in policy on Seatline | Subscription for Claude, Codex and Grok. Gemini's cloud route is an opt-in. API-key sign-ins are refused, because keys get their own path. | Proposed, following Lineleaf |
| Default models | Quick: Claude `haiku`, low effort. Analysis: Claude `opus`, high. Book pass: Claude `sonnet`, medium. Synthesis: Claude `opus`, high. | Proposed. Revisit after live measurement and real usage-limit experience. |
| Second reader pair | Claude and Codex | Proposed |
| PDF auto-open | On for `.pdf` addresses | Proposed |
| Distribution | Personal use first | Open. See [terms of use](../architecture/seatline-integration.md#terms-of-use-and-distribution) before publishing. |

## References

- [Seatline](https://github.com/davletovb/seatline) — the shared provider companion.
- [Lineleaf](https://github.com/davletovb/Lineleaf) — the existing Seatline extension whose conventions Sharh follows.
- [PDF.js](https://mozilla.github.io/pdf.js/) and [Readability](https://github.com/mozilla/readability) — the extraction engines.
