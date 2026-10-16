# Phase 1 prompts and evaluation

`src/analysis/lenses.mjs` supplies the trusted lens instructions and passage actions. `assemblePrompt` keeps rules, numbered document data and task/contract separate; action selection is an enum, not text smuggled through the focus field. The current prompt version is `analysis-5`, adding G's Scholar toolkit. Every record shape specifies its literal `t`, and selections include exact selected text alongside offsets. Prompt identity hashes actual rules, lens wording, output contract and custom snapshot as well as scope/configuration, so later wording drift is detected even if a version bump is missed. Earlier versions remain readable but cannot continue under changed instructions. A manual failed-passage retry is a fresh run under the current version. G's separate six-lens evaluation uses `--phase-two`; neither report accepts a phase automatically.

Summary defines four scales and the arc; Structure preserves heading starts, original title wording and hierarchy (the title is a source label; its gist uses the requested output language); Logic separates statements, reconstructed inferences and justified gaps; Thinking covers concepts, causal/dependency relations and all nine supported facet kinds without requiring unsupported claims. Translate pairs original/translated terms. Define cites the earliest *supplied* introduction and acknowledges when it lies outside the scope. The shared rules prohibit document/focus/repair-output instructions and tool use, constrain references and quotes, and specify output language/script. Prompts are not evidence of live injection resistance or semantic quality.

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

Generation reports and blank `.review.json` forms are written under `test-results/` by default. Review-only mode builds nothing and defaults to a sibling `<input>.reviewed.json`; it refuses to overwrite the report or form, including symlink/hardlink aliases. Generation refuses output paths that overwrite its manifest/corpus inputs or each other. Checkpoints are written atomically. Each records source commit/dirty state, prompt version, item/provider/action/language, extraction version, exact scope text, raw first/repair attempts, portable saved-run metadata, canonical findings and timings. Session handles and owned cleanup groups are excluded from run exports.

Fixture answers are created lazily from the actual request when the path runs; preflight/setup failures cannot leave a previous cell's answer queued. The run uses a unique evaluation cleanup namespace. Every exit attempts document deletion, maintenance and all resource closures, including partial setup. Cleanup failures/pending intentions are recorded and make the command fail; one close failure cannot skip the next. A setup failure writes a failed report with zero live-provider claims.

Automatic scores use the **raw original answer**, not the repaired or filtered display records. This catches malformed/framed output, removed references, bad quotations, duplicate/dangling IDs, cycles, incomplete output and injection canaries. The observer-isolated final-output hook is the only raw-output source, including non-streaming paths; late deltas cannot contaminate the initial answer. A successful repair remains visible and saved, but cannot improve the original quality score. Missing source/provider runs remain failed matrix cells; later cells still execute.

| Measure | Target |
| --- | --- |
| Parse rate | ≥95% of nonblank raw lines valid |
| Reference validity | ≥98%; anchored findings required; passage actions must cite at least one selected paragraph |
| Quotations | Every provided quote verified; quotation presence is diagnostic, with no forced stated/quoted node |
| Structural integrity | No duplicate/dangling identifiers or parent cycles |
| Structure heading coverage | ≥90% of *annotated* headings, matching both original title and paragraph start; missing/retitled headings count against it |
| Record budget | Findings must not exceed `maxRecords`; meta/end do not consume the budget |
| Language metadata | Defaults to `en`; same primary language, no conflicting explicit script/region (a missing script such as `uz` for `uz-Latn` is accepted) |
| Completion | End marker, no trailing output, no path truncation |
| Injection marker | Not observed; conservative canary check, not a semantic proof |

Lens/action shape diagnostics additionally require Summary's four levels/arc, Structure sections, Logic nodes/steps (and edges for multi-node arguments), Thinking concepts/facets, and passage term pairs where required. Prompts permit omitting unsupported gaps/facets instead of fabricating them. Inferred-only Logic and unquoted stated nodes can pass; expert review decides whether a safe quotation was unjustifiably omitted. Valid context references remain allowed alongside a selected-paragraph citation. Scope offsets use JavaScript/DOM UTF-16 units, including astral/combining text. Reports retain record/facet kinds for corpus-level review. Actual language/script, translated meaning, introducing-paragraph accuracy, insight and faithfulness require expert review; compatible `meta.lang` is not proof.

## Conversation tasks and tiers

The conversation's readings are defined once in `src/analysis/tasks.mjs`: each task is a lens, optionally an operation of it, a record budget and a tier. The interface, the tests and this evaluation all read that table, so they cannot disagree.

| Task | Runs as | Records | Tier |
| --- | --- | --- | --- |
| Get the gist | Summary, `gist` operation | 2 | Analysis |
| Check the argument | `check` lens | 10 | Analysis |
| Learn the terms | Terms, `learn` operation | 8 | Quick |
| Study it deeply | `deep` lens | 22 | Analysis |
| How it is built | Structure, `outline` operation | 12 | Quick |
| Main ideas | `ideas` lens | 5 | Analysis |
| What kind of text this is | Meta-reading | the Detail setting | Quick |
| Who it cites | Literature | the Detail setting | Quick |
| Questions to check yourself | Questions, `quiz` operation | 5 | Quick |

The selection actions (Explain, Translate, Argument, Define) all run on the Quick tier. Quick is for descriptive help; Analysis is for a judgment (the argument check) or a composition (the gist, the main ideas, the deep reading). The assignments are a starting point and each person can still choose the model behind each tier in Settings.

```sh
npm run evaluate -- --fixture --tasks                  # scripted: the matrix and the task-level checks
npm run evaluate -- --companion PATH --tasks --compare-tiers --quick-model haiku --analysis-model opus
```

`--tasks` runs every task (or the ones named with `--task`) on its declared tier and writes `test-results/task-evaluation.json`. Its task-level checks are floors a machine can count, not a quality claim: the gist has exactly two records, a line of at most 25 words and an abstract of at most 70, with no paragraph marks inside the text; the argument check has one claim, two or three reasons and one assessment; Learn the terms returns one to eight terms; the outline has at most twelve flat sections; Main ideas has three to five themes and nothing else; the questions are three to five with at least one that tests understanding; the deep reading has one brief synthesis, up to eight flat sections, the argument check and up to three questions.

`--compare-tiers` runs each task on both tiers, with `--quick-model` and `--analysis-model` choosing the model behind each, and adds a `comparison` table: for every item, provider and task, whether each tier passed, what it missed, how many records it returned, how long it took, and a verdict (`both_pass`, `quick_falls_short`, `only_quick_passes`, `both_fail`). Run it live before moving a task to the Quick tier. A scripted fixture proves the harness and the checks; only a live run says whether a cheaper model is good enough, and a reader still has to judge the answers themselves, which the review form below is for.

## Expert review and acceptance

Review every run against its captured scope and raw/canonical findings. The form records faithfulness, structural accuracy, argument accuracy, insight and usefulness (1–5), reviewer, date, notes and accepted/revise disposition. Source/run/prompt identities must match; stale forms, duplicate rows, missing scores and invalid ratings are refused. To validate a completed form **without new model calls**:

```sh
npm run evaluate -- --report test-results/f-live.json --reviews test-results/f-live.review.json --out test-results/f-reviewed.json
```

The command never sets `phaseOneAccepted:true`. F-08 needs owner-machine Claude/Codex runs meeting the automatic targets, expert sign-off, naturally occurring licensed texts supplementing the synthetic fixtures, plus outstanding A-02/A-03/B-05 and E-07 screen-reader gates. Stand-ins, synthetic scores and generated review forms cannot close those gates.
