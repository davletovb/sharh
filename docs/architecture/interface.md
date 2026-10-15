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
3. **Reading.** Title and chips (scope, model, language), then Analyze / Ask / History. Analyze has lens chips (Summary, Structure, Logic, Thinking, and a More menu with the rest, Deep read and Second reading), an Adjust section (Detail, number of findings, Focus, Theoretical frame), and a menu for exports and Open in full tab.

Saved readings list under the cards. A chosen passage waits in the panel until it is answered; the toolbar button shows a dot while one is pending.

## Settings

Sections: Connection, Models, Reading, Lenses, Sites and PDFs, Appearance, Your data. Models has a default model, per-job overrides (quick passage actions, book chapters, synthesis follow the default unless overridden) and the second reader. Reading has the output language, Detail (concise, standard, thorough; 12, 24 or 60 findings), and the auto-read choice. Preferences live in `chrome.storage.local.sharhReading` (`src/ui/preferences.mjs`, validated on load).

Lenses lists the custom lenses (stored in `sharhCustomLenses`, at most 30) with Edit, Export and Delete, a form (name, instructions, what the lens may produce, default model job) and file import. Choosing a record type also chooses the types it refers to, so a saved lens always passes validation. A saved lens appears in the More menu of every lens bar without a reload. The full-tab Library keeps its own editor over the same store.

## Design system

`ui/style.css` defines CSS tokens for two themes: Ink (dark) and Parchment (light). System follows `prefers-color-scheme`. Serif titles (Noto Serif, bundled), a gold primary action, chips, segmented controls, callouts and menus (`ui/components.mjs`), icons in `ui/icons.mjs` and the eight-point star mark. The toolbar injected into pages carries its own copy of the tokens in a closed shadow root and follows the chosen theme.

Every foreground/background pair used is checked against WCAG AA in both themes. Browser tests run axe on the panel, Settings and the views in both themes, and exercise keyboard use of the toolbar (arrow keys, Home, End, Escape).

## Defaults chosen without an owner answer

System theme, Ask kept as a tab, English-only interface. Each is a one-line change.
