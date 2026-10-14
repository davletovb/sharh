# Phase 1 prompts and evaluation

`src/analysis/lenses.mjs` supplies the four trusted lens instructions and four passage actions. `assemblePrompt` keeps rules, numbered document data and task/contract separate; action selection is an enum, not text smuggled through the focus field. The prompt version is `analysis-2`. Old versions remain readable, but their continuation is refused rather than silently changing instructions.

Summary defines four scales and the arc; Structure preserves heading starts and hierarchy; Logic separates statements, reconstructed inferences and justified gaps; Thinking covers concepts, causal/dependency relations and all nine supported facet kinds without requiring unsupported claims. Translate pairs original/translated terms. Define cites the earliest *supplied* introduction and acknowledges when it lies outside the scope. The shared rules prohibit document/focus/repair-output instructions and tool use, constrain references and quotes, and specify output language/script. Prompts are not evidence of live injection resistance or semantic quality.

## Commands

From Node 24+, with Chromium installed for Playwright:

```sh
npm ci --ignore-scripts
npx playwright install chromium
# No provider calls: production readers/engine with explicitly scripted answers.
npm run evaluate -- --fixture
# Live: the already installed/authorized owner's companion and actual provider CLIs.
npm run evaluate -- --companion /absolute/path/to/seatline-companion --out test-results/f-live.json
```

The default matrix is 14 corpus items × Claude/Codex × four lenses and four passage actions: **224 runs**. It executes sequentially, with no simultaneous generation. Live runs consume subscription usage. Start with `--item article-en --lens logic --no-passages --provider claude` to inspect one turn. `--lens`/`--provider`/`--item`/`--action` may repeat. `--model` and `--language` override the model/output language explicitly. Gemini cloud access requires `--allow-gemini-cloud` in addition to the production path's checks. The default providers remain Claude and Codex; selecting others never establishes their acceptance automatically.

CI adds `--fake-provider PATH` with the pinned companion. That mode creates an isolated registry/profile, authorizes only the test development origin, uses stand-in CLIs and labels the result `real-broker-stand-ins`. It does not use the owner's credentials or change their grants. Neither test mode can label a report live.

`--manifest corpus/local-manifest.json` supports licensed natural-text additions using the same manifest shape and repo-relative paths. Keep private material under ignored `corpus/private/`; record provenance, license, SHA-256 and annotated headings. Supplied source hashes are checked before extraction. The browser serves only this repository. Reports contain source excerpts/raw outputs, so review them before sharing. Text is sent to a provider only in explicit companion mode.

## Reports and scoring

Reports and blank `.review.json` forms are written under `test-results/` by default. Each checkpoint records source commit/dirty state, prompt version, item/provider/action/language, extraction version, exact scope text, raw first/repair attempts, portable saved-run metadata, canonical findings and timings. Session handles and owned cleanup groups are excluded from run exports. The run uses a unique evaluation cleanup namespace and drains its cleanup intentions; a pending cleanup makes the command fail.

Automatic scores use the **raw original answer**, not the repaired or filtered display records. This catches malformed/framed output, removed references, bad quotations, duplicate/dangling IDs, cycles, incomplete output and injection canaries. Final-only/non-streaming output uses an observer-isolated engine hook. A successful repair remains visible and saved, but cannot improve the original quality score. Missing source/provider runs remain failed matrix cells; later cells still execute.

| Measure | Target |
| --- | --- |
| Parse rate | ≥95% of nonblank raw lines valid |
| Reference validity | ≥98%; anchored findings required |
| Quotations | Every raw displayed quote verified; stated Logic quote where supplied prose permits |
| Structural integrity | No duplicate/dangling identifiers or parent cycles |
| Structure heading coverage | ≥90% of *annotated* headings; missing extraction headings count against it |
| Completion | End marker, no trailing output, no path truncation |
| Injection marker | Not observed; conservative canary check, not a semantic proof |

Lens/action shape diagnostics additionally require Summary's four levels/arc, Structure sections, Logic nodes/steps (and edges for multi-node arguments), Thinking concepts/facets, and passage term pairs where required. Prompts permit omitting unsupported gaps/facets instead of fabricating them. Reports retain record/facet kinds for corpus-level review. Actual language/script, translated meaning, introducing-paragraph accuracy, insight and faithfulness require expert review; a matching `meta.lang` is not proof.

## Expert review and acceptance

Review every run against its captured scope and raw/canonical findings. The form records faithfulness, structural accuracy, argument accuracy, insight and usefulness (1–5), reviewer, date, notes and accepted/revise disposition. Source/run/prompt identities must match; stale forms, duplicate rows, missing scores and invalid ratings are refused. To validate a completed form **without new model calls**:

```sh
npm run evaluate -- --report test-results/f-live.json --reviews test-results/f-live.review.json --out test-results/f-reviewed.json
```

The command never sets `phaseOneAccepted:true`. F-08 needs owner-machine Claude/Codex runs meeting the automatic targets, expert sign-off, naturally occurring licensed texts supplementing the synthetic fixtures, plus outstanding A-02/A-03/B-05 and E-07 screen-reader gates. Stand-ins, synthetic scores and generated review forms cannot close those gates.
