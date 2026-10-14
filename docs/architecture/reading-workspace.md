# Reading workspace

Slice E connects the side panel and full-tab reader to the D engine. Both mount the same `createWorkspace` controller, model picker, theme controls and streaming views. The worker remains responsible for native messaging and provider pacing; it never parses model output.

## Controls and model choices

The workspace identifies the document, current scope, full D request size, estimated tokens, output language and target. Four tier defaults live in `chrome.storage.local.sharhReading`: Quick (Haiku/low), Analysis (Opus/high), Book pass (Sonnet/medium) and Synthesis (Opus/high). These retain A's provisional status until live-provider measurements. Book pass uses the Analysis output-cap class.

Discovery groups options by path and provider, reports sign-in/policy and capability badges, and shows effort/speed only when advertised. Providers without model suggestions get a free model ID and provider-default choice. Workspace choices override the saved defaults; “Save as tier default” persists that tier. Provider-default effort and speed are saved as explicit nulls. Passage actions resolve a separate Quick target and preserve the workspace's tier, model override and scope. Provider readiness and sign-in policy are still enforced on every send by B. No provider is silently substituted after a failure.

Analyze runs Summary, Structure, Logic or Thinking through `AnalysisEngine`. Stop preserves partial output; Continue offers session reuse or fresh scope context. Full production-frame sizing runs before sending. Ask has its own area but grounded chat remains G-01. Library opens stored documents; collection management remains H-01.

## Views and source inspection

- Summary: cards for line/abstract/section/brief, and an ordered arc timeline.
- Structure: section outline, parent links, collapsible branches and mind map.
- Logic: argument graph, stated/inferred claims, connections, ordered steps and gaps.
- Thinking: concept map, causal relations, and facet cards.

Text enters DOM nodes only through `textContent`. References are real buttons. Every map has the complete text outline, keyboard-operable node inspection, zoom/reset and directional pan controls. SVG labels use shortened display text and full accessible labels. Selecting a finding opens an inspector with its stated/inferred basis and saved source paragraphs. Long section spans use their first/last reference buttons while the source's paragraph navigator retains every block.

Cards are appended in animation frames with a six-millisecond/eight-record budget. Layout is throttled and coalesced in `graph-worker.mjs`, with one outstanding layout; Dagre handles argument maps, D3 hierarchy handles structure and D3 force handles concepts. Layout never runs in the UI thread. Disposed views cancel pending frames/timers and terminate their worker. A failed worker leaves the text outline available.

References use the existing C HTML/PDF anchors, including quotation fallback. A missing match reports that it cannot be found. Inspection stays within the workspace; only an explicit paragraph reference navigates. Historical views and comparisons use their run's original extraction version. The reader displays historical paragraphs alongside the workspace without replacing its document, selected run, comparison or source connection. The panel opens the appropriate reader when its source tab is unavailable; paragraph deep links run after the document finishes opening. Both surfaces offer an Allow action and source/file-access guidance when injection fails.

## Passage actions and optional access

Selecting source text on an enabled site or within the PDF/local-text reader opens Explain, Translate, Logic and Define. It preserves selected spans, the section heading, two preceding paragraphs and one following paragraph. Requests use the Quick tier and chosen output language. F-06 supplies explicit versioned action prompts separately from focus data; live prompt-quality validation remains open.

No new manifest permissions are added. The panel's site-enable button requests the current origin. The toolbar checks permission before first appearance and caches that grant until revocation; every action is rechecked by the worker. Revocation hides existing toolbars and clears the cached grant. Page UI lives in a closed shadow root, and source extraction excludes Sharh UI. The toolbar captures a DOM range and extracts only when an action is clicked, carrying the resulting extraction and spans together without changing the explicit reader's extraction. Editable and unchanged selections, plus unrelated keyups, do no extraction work. A selection outside the main article falls back to an extraction including its visible region; its anchors retain that mode for later jumps. The four controls support keyboard traversal and Escape, which dismisses the selection until it changes.

A content-script action opens the panel from its button gesture, verifies the source has not navigated, stores the extraction and a window-scoped action intention, and lets the panel own generation. Alternate passage snapshots are stored without replacing the current article or marking its runs stale; the passage engine explicitly permits that saved extraction. Ordinary Analyze still refuses stale scopes. A Web Lock serializes handoff. The intention stays pending through setup; an awaited engine begin hook journals its ID to the allocated run and acknowledges it before a provider send. An active run refuses the handoff before switching documents. Failed setup offers Retry/Dismiss, and reload finds an accepted run by that durable ID instead of replaying it. Passage requests use their own budget, and invalid Analyze input reports failure. A second pending intention cannot overwrite an unconsumed one. A model is contacted only after Analyze or a passage action.

## Persistence, themes and accessibility

Reopening a document loads saved runs without another generation. History identifies lens, version, target, scope, status and stale extraction. Two saved versions can be inspected side by side, each with its own original paragraphs. Document saves record a Library date; legacy rows omit the date separator. Controller/history completion does not wait for animation frames, so hidden readers release their run and passage lock after durable engine completion. The workspace supplies the panel's single run status/Stop surface. D continues to own version allocation, owner recovery, cancellation and deletion maintenance.

System appearance selects ink-and-gold or parchment unless the reader overrides it. Locally bundled Noto Serif covers Latin/extended Latin and Cyrillic/extended Cyrillic; Noto Sans Arabic supplies Arabic. Font and graph-library licenses ship with the reproducible package. User text uses automatic direction and bidi isolation. Focus is visible and reduced motion disables transitions/animation.

Automated tests run axe on panel/settings and every Phase 1 view in both themes, exercise keyboard inspection/toolbar controls, and observe actual main-thread tasks while 200 records stream. E-07 remains IMPLEMENTED — VERIFY until an owner-machine screen-reader report is recorded. Automated accessibility checks do not replace that pass.
