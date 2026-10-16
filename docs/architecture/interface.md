# Interface

Version 1, established 2026-10-15. Status: implemented; owner review of the visual design is open.

Sharh has four surfaces. There is no popup. The toolbar button opens the side panel (on a PDF it opens the PDF in the reader).

| Surface | Job |
| --- | --- |
| Side panel | Read the page in the current tab and analyze it. |
| Full tab (`ui/reader.html`) | Open PDFs, files and addresses, read the source beside the analysis, and use the Library and the heavy tools. |
| Settings (`ui/settings.html`) | Connection, models, reading defaults, site access, appearance and data. Nothing about models or tiers is chosen anywhere else. |
| Selection toolbar | Explain, Translate, Logic, Define and Ask about a selected passage, on a page and in the PDF reader. |

## The consent rule

Sharh never reads a page without being asked.

- The side panel shows **Read this page?** with Read page and Not now. Extraction runs on this computer and sends nothing to a model; text goes to a model only when a lens runs.
- Settings → Reading has **Reading a page** with two choices: *Ask me first* (the default) and *Read pages I have allowed automatically*. The second reads only a page that is complete, in a tab Sharh can already see (site access granted), that is not a PDF, while nothing else is open and a model is connected. Anything else still asks.
- The right-click item **Sharh → Read this page** is itself a request. It opens the panel and stores a short-lived read request (`sharh:read-intent`, 30 seconds) that the panel consumes once.

## Side panel states

1. **Not connected.** A numbered setup (install Seatline, allow Sharh, sign in) with Check again and Open setup. The same `connectionSteps` helper drives Settings.
2. **Ask first.** The consent card above, with a compact form after Not now. A PDF tab offers Open this PDF in Sharh instead.
3. **Reading: a conversation.** The title and one quiet line for what is being read (whole page, or a chosen section), then the conversation, then one input at the bottom.
   - Before anything is asked: "I’ve read this text. What would you like to know?" and four goals: *Get the gist* (Summary), *Check the argument* (Logic), *Learn the terms* (Terms) and *Study it deeply* (Structure, Logic and Thinking together).
   - Choosing a goal adds what was asked as a bubble and the answer as a card with a plain title ("The gist", "The argument", "Explain · ¶3"). The model, date and status sit behind **Details** on each card. After an answer, two follow-up chips offer the other goals.
   - The same input is **Ask**. Answers are cards with paragraph references. Selecting text on the page uses the selection toolbar; its answers arrive as "Explain · ¶3" cards, and *Ask about this* puts the passage above the input.
   - The ✦ button beside the input lists every other lens in plain words ("How it is built", "Who it cites") and any custom lenses.
   - Progress, "Continue", "Retry with default model" and problems share one strip above the input. It is hidden when there is nothing to say. With no usable model it says so once and offers *Choose a model*.
   - There is no tab bar, no model, language or token chips, and no Adjust. The header ⋯ menu holds earlier readings, exports, and in the full tab the Library and the Studio view.

The full tab uses the same conversation beside the source text. **Studio view** (⋯ menu in the full tab, or `?layout=studio`) restores the complete set of controls for power use: lens list, Adjust (detail, number of findings, focus, theoretical frame), history and comparison, Second reading and the Library tools.

## Library page (full tab)

The full tab's header has a **Library** button; with nothing open, the Library is the home page. It takes the whole width and has four tabs (arrow keys move between them):

- **Documents:** everything read so far as cards (title, kind, date, Open, Delete), newest first, with a filter once there are four or more. Opening one returns to the reading.
- **Collections:** *Saved items* (a document or a chosen chapter saved from the reading), *Collections* (create, reorder, add saved items, reorder or remove members) and *Read together* (literature review, meta-synthesis, compare two saved items).
- **Books:** whole-book chapter jobs with pause, resume and the book-level lens, and the failover order for when a model is unavailable.
- **Glossary:** pick any book without opening it, see its terms (term → translation, other spellings, note), filter them, and add, edit or delete one in the form beside the list. Deleting asks twice. Terms from the Terms lens arrive on their own. Renaming a term replaces the old one, and if the new name is refused the old one comes back.

Studio view shows the same controls stacked without tabs. Custom lenses are edited in Settings.

## Settings

Sections: Connection, Models, Reading, Lenses, Sites and PDFs, Appearance, Your data. Models has a default model, per-job overrides (quick passage actions, book chapters, synthesis follow the default unless overridden) and the second reader. Reading has the output language, Detail (concise, standard, thorough; 12, 24 or 60 findings), and the auto-read choice. Preferences live in `chrome.storage.local.sharhReading` (`src/ui/preferences.mjs`, validated on load).

Lenses lists the custom lenses (stored in `sharhCustomLenses`, at most 30) with Edit, Export and Delete, a form (name, instructions, what the lens may produce, default model job) and file import. Choosing a record type also chooses the types it refers to, so a saved lens always passes validation. A saved lens appears in the More menu of every lens bar without a reload. The full-tab Library keeps its own editor over the same store.

## Design system

`ui/style.css` defines CSS tokens for two themes: Ink (dark) and Parchment (light). System follows `prefers-color-scheme`. Serif titles (Noto Serif, bundled), a gold primary action, chips, segmented controls, callouts and menus (`ui/components.mjs`), icons in `ui/icons.mjs` and the eight-point star mark. The toolbar injected into pages carries its own copy of the tokens in a closed shadow root and follows the chosen theme.

Every foreground/background pair used is checked against WCAG AA in both themes. Browser tests run axe on the panel, Settings and the views in both themes, and exercise keyboard use of the toolbar (arrow keys, Home, End, Escape).

## Defaults chosen without an owner answer

System theme, Ask kept as a tab, English-only interface. Each is a one-line change.
