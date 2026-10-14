# D — Analysis engine slice

2026-10-14 · Owner: Codex

D-01–D-06 are one accepted implementation slice. C is merged; B-03 and C-01 are DONE. D-02 is implemented and tested before its same-slice consumers D-03–D-06 are accepted. This does not close A-02, A-03 or B-05's owner/live gates.

The engine is path-neutral and runs in an extension page, not in the native-message worker. Prompts serialize source data as JSON; rules and tasks remain distinct. The schema is shared by task contracts and validation. Unknown model fields never enter records. Basic record rendering uses DOM text only; the E milestone still owns the panel and graph/card views. The fake path is dependency-injected, never a setting that silently replaces a live provider.

Runs retain an extraction version and immutable prompt/task configuration. Repair replaces an attempt, not a second visible run, and happens at most once per turn without reducing the useful record count. Explicit continuation creates a linked version, directly seeds canonical retained history, and validates new records against it. Browser locks identify live owners; an ownerless running version is interrupted and resumable. Complete requests are measured before version allocation. Sessions are reused only for the identical scope/prompt/target; otherwise the document is resent. Session ownership survives page closure and repair. Deletion's revisioned maintenance outbox is drained through the existing worker path and pacing barriers, never imported from another machine.

F-01 still owns live injection evaluation and the final prompt-quality freeze. D's versioned rules implement the required contract without claiming live-provider compliance.
