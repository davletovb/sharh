# Interface

Version 1, established 2026-10-15. Status: implemented; owner review of the visual design is open.

Sharh has four surfaces. There is no popup. The toolbar button opens the side panel (on a PDF it opens the PDF in the reader).

| Surface | Job |
| --- | --- |
| Side panel | Read the page in the current tab and analyze it. |
| Full tab (`ui/reader.html`) | Open PDFs, files and addresses, read the source beside the analysis, and use the Library and the heavy tools. |
| Settings (`ui/settings.html`) | Connection, models, reading defaults, site access, appearance and data. Nothing about models or tiers is chosen anywhere else. |
| Selection toolbar | Explain, Translate, Argument, Define and Ask about a selected passage, on a page and in the PDF reader. **Argument** (the `check` lens run on the selection as the `Argument` action, on the Quick tier) reads in three short parts, *What these lines do*, *How they connect* and *A weakness here* (only when the text supports one), with no graph; the parser keeps one claim, up to two connections and one weakness. It replaces Logic, which stays in the action table so a saved Logic run can still be retried and which a page still showing the older toolbar sends as Argument. A **Define** card has a **Keep in glossary** button. |

## The consent rule

Sharh never reads a page without being asked.

- The side panel shows **Read this page?** with Read page and Not now. Extraction runs on this computer and sends nothing to a model; text goes to a model only when a lens runs.
- Settings → Reading has **Reading a page** with two choices: *Ask me first* (the default) and *Read pages I have allowed automatically*. The second reads only a page that is complete, in a tab Sharh can already see (site access granted), that is not a PDF, while nothing else is open and a model is connected. Anything else still asks.
- The right-click item **Sharh → Read this page** is itself a request. It opens the panel and stores a short-lived read request (`sharh:read-intent`, 30 seconds) that the panel consumes once.

## Side panel states

1. **Not connected.** A numbered setup (install Seatline, allow Sharh, sign in) with Check again and Open setup. The same `connectionSteps` helper drives Settings.
2. **Ask first.** The consent card above, with a compact form after Not now. A PDF tab offers Open this PDF in Sharh instead.
3. **Reading: a conversation.** The title and one quiet line for what is being read (whole page, or a chosen section), then the conversation, then one input at the bottom.
   - Before anything is asked: "I’ve read this text. What would you like to know?" and four goals: *Get the gist* (the Summary lens run as the `gist` operation: its own instruction asks for exactly two records, a sentence of at most 25 words and a three-sentence abstract in plain words with no labels and no paragraph marks in the text, and the card shows only those two; the Summary lens in Studio keeps the sections and the arc), *Check the argument* (the `check` lens: a main claim, two or three reasons, the strongest point, the weakest link only when the text shows one, and what the text establishes and leaves unestablished, in that order, with assumptions and the strongest objection folded underneath. It is an assessment based on the supplied text, judged by the evidence, whether the conclusion follows and whether alternatives are addressed, never a fact check or a score. It has no map. The Logic and Critique lenses stay in Studio, and Critique is no longer in the conversation's menu), *Learn the terms* (the Terms lens run as the `learn` operation: at most eight terms, most useful first, fewer when fewer qualify, each a card with the term, its translation, its meaning here and a **Keep in glossary** button; keeping makes it one of the book's own glossary entries, and terms a reading only suggested are not used by any prompt until kept) and *Study it deeply* (the `deep` lens: one Analysis request that returns a synthesis of at most 120 words, a compact outline of at most eight sections, the argument check, assumptions and at most three open questions, shown as *In short*, *How it is built*, the argument parts and a folded *Assumptions and open questions*, with no map; a text too long for one request asks the reader to choose a section, as every reading does, and the staged analysis for whole books stays in Library → Books. Studio's Deep read button keeps the three-lens reading).
   - Choosing a goal adds what was asked as a bubble and the answer as a card with a plain title ("The gist", "The argument", "Explain · ¶3"). The model, date and status sit behind **Details** on each card. After an answer, two follow-up chips offer the other goals.
   - The same input is **Ask**. Answers are cards with paragraph references. Selecting text on the page uses the selection toolbar; its answers arrive as "Explain · ¶3" cards, and *Ask about this* puts the passage above the input. The header ⋯ menu's **Conversations** opens the **Ask page**: every saved conversation about this text as chips, the open one in full (each question with its grounded answer and paragraph references), a New conversation button, and a way back to the reading. Questions asked on that page are saved with the others but appear in its own transcript rather than in the reading's stream.
   - **Paragraph marks in text:** a mark such as ¶8, ¶12–13 or [¶17] inside a finding or an answer is a button that opens that paragraph in the source, the same as the chips under it. A range opens its first paragraph, and a number the text does not have stays plain text.
   - **Cards stand alone.** In the conversation a result is shown once: Themes and citations are cards with no table repeating them, facets and question levels use plain names ("Where the author stands", "Did you follow it?"), a relation names the two findings it joins instead of their ids, and a map opens only after *Show map*. Studio keeps the tables, the raw kinds and the open map. Critique groups strengths, limitations and counterarguments, and the quality of the evidence separately in both views.
   - **Questions and findings connect to Ask.** Each question card has **Try an answer** (a box, then *Check my answer*) and **Show a suggested answer**; any other finding has **Ask about this**, which puts what it is about above the question box. Each is an Ask turn tied to the finding: the turn records the reading's run, the finding's place in it and a short label, and Ask answers from that reading's own text version and scope (a new conversation when that differs from the open one, the same conversation when it matches). Questions that ask for analysis, evaluation or debate say they may have more than one defensible answer. Ask itself still sees only earlier Ask turns, so the link is what lets "answer question two" or "explain that weakness" work.
   - The ✦ button beside the input lists the other readings in three groups, then any custom lenses. **Understand**: *How it is built* (the Structure lens run as the `outline` operation on the Quick tier: at most twelve sections in reading order, never nested, each a card with the section's own heading, one plain sentence and a single ¶ range; there is no map, and a text without headings says *Inferred outline* above the list) and *Main ideas* (the `ideas` lens: three to five theme records saying what each idea is, why it matters and where it develops, with no codes, memos or tensions). **Place it**: *What kind of text this is*, *Who it cites* and *Where it sits*, which is disabled with its reason in the label when the chosen model has no web search. **Test yourself**: *Questions to check yourself* (the Questions lens run as the `quiz` operation on the Quick tier: three to five questions, at least one that tests what the text says, other levels only where the text raises them, and no answers or hints). Thinking, Themes and Critique stay in Studio.
   - Progress, "Continue", "Retry with default model" and problems share one strip above the input. It is hidden when there is nothing to say. With no usable model it says so once and offers *Choose a model*.
   - There is no tab bar, no model, language or token chips, and no Adjust. The header ⋯ menu holds earlier readings, exports, and in the full tab the Library and the Studio view.

The full tab uses the same conversation beside the source text. **Studio view** (⋯ menu in the full tab, or `?layout=studio`) is the workbench for deliberate runs. It gives the analysis column more room, opens with a Studio bar that explains it and returns to the conversation, and keeps every control: the lens list, Adjust (detail, number of findings, focus, theoretical frame), the scope and size line, saved readings with version comparison, Second reading, exports and the Library areas. Its tabs are Analyze, Ask, History and Library.

## Library page (full tab)

The full tab's header has a **Library** button; with nothing open, the Library is the home page. It takes the whole width and has four tabs (arrow keys move between them):

- **Documents:** everything read so far as cards (title, kind, date, Open, Delete), newest first, with a filter once there are four or more. Opening one returns to the reading.
- **Collections:** on the full tab's Library page, two columns. The left lists the collections (each with its text count, the open one marked), a field to start another, and the saved texts (a document or a chosen chapter saved from the reading) with Open, Remove and a checkbox to pick two for *Compare*. The right shows the open collection: its texts numbered in reading order with earlier, later and remove controls, a picker for adding a saved text that is not yet in it, move-earlier and move-later for the collection itself, a two-step *Delete collection*, and *Read this collection together* (literature review, meta-synthesis), which needs at least two texts and says so. Studio view keeps the original controls.
- **Books:** whole-book chapter jobs with pause, resume and the book-level lens, and the failover order for when a model is unavailable.
- **Glossary:** pick any book without opening it, see its terms (term → translation, other spellings, note, and a *Suggested* mark with **Keep** for terms a reading suggested), filter them, and add, edit or delete one in the form beside the list. Deleting asks twice. Terms from the Terms lens arrive on their own. Renaming a term replaces the old one, and if the new name is refused the old one comes back.

Studio view shows the same controls stacked without tabs. Custom lenses are edited in Settings.

## Settings

Sections: Connection, Models, Reading, Lenses, Sites and PDFs, Appearance, Your data. Models has a default model, per-job overrides (quick passage actions, book chapters, synthesis follow the default unless overridden) and the second reader. Reading has the output language, Detail (concise, standard, thorough; 12, 24 or 60 findings), and the auto-read choice. Preferences live in `chrome.storage.local.sharhReading` (`src/ui/preferences.mjs`, validated on load).

Lenses lists the custom lenses (stored in `sharhCustomLenses`, at most 30) with Edit, Export and Delete, a form (name, instructions, what the lens may produce, default model job) and file import. Choosing a record type also chooses the types it refers to, so a saved lens always passes validation. A saved lens appears in the More menu of every lens bar without a reload. The full-tab Library keeps its own editor over the same store.

## Design system

`ui/style.css` defines CSS tokens for two themes: Ink (dark) and Parchment (light). System follows `prefers-color-scheme`. Serif titles (Noto Serif, bundled), a gold primary action, chips, segmented controls, callouts and menus (`ui/components.mjs`), icons in `ui/icons.mjs` and the eight-point star mark. The toolbar injected into pages carries its own copy of the tokens in a closed shadow root and follows the chosen theme.

Every foreground/background pair used is checked against WCAG AA in both themes. Browser tests run axe on the panel, Settings and the views in both themes, and exercise keyboard use of the toolbar (arrow keys, Home, End, Escape).

## Defaults chosen without an owner answer

System theme, Ask kept as a tab, English-only interface. Each is a one-line change.
