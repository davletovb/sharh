# Slice F — Phase 1 prompts and evaluation

Accepted implementation scope: F-01–F-07, requested together after E merged as `12cd2db`. F-01 may proceed while A-03's live gate is open, and dependent F lenses may proceed against its versioned rules. This permits deterministic development, not Phase 1 acceptance or a quality freeze.

F-08 remains blocked by A-02/A-03/B-05/E-07 owner-machine gates, live Claude/Codex corpus evaluation, expert review and naturally occurring licensed texts supplementing the synthetic corpus. Stand-ins establish integration and metric mechanics only. They cannot establish language, faithfulness, insight, injection resistance or model quality.

Evaluation uses production readers, prompt assembly, the analysis engine and Seatline path. Reports preserve raw initial/repair output and canonical saved records separately. Automatic targets are computed on the original answer, so repair and reference filtering cannot launder defects. Review forms bind to report/run/prompt identities. No report automatically accepts Phase 1.

Prompt changes increment the prompt version. Earlier runs remain readable but cannot continue under a different prompt version. Existing A draft probes remain unchanged and source-labelled.
