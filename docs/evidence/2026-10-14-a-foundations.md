# A foundation evidence

Date: 2026-10-14. Source: this foundation slice, Seatline pin `ba712f70eb4acd43b45b326bb4907feb9ded9c2f`.

Local Node 24 checks: the corpus hash/licensing/coverage checks, manifest-key ID agreement, output-metric adversarial fixtures and probe-transport tests passed (9 tests). The local esbuild bundle succeeded. Full browser and companion verification is being run through the pinned CI workflow; see the pull request checks for the final result.

The execution container refuses AF_UNIX socket creation. Local Chrome failed before loading a page (`process_singleton_posix.cc`, `socket() failed: Operation not permitted`); this is an environment failure, not a successful extraction result. Browser and real-broker checks must pass in CI. Their JSON reports are uploaded as `corpus-and-prototype-evidence` and `pinned-companion-evidence`. No live Claude or Codex provider was invoked, and no owner's Chrome result is claimed.

The [decision and reproduction commands](../decisions/a-foundations.md) describe each automated check and the remaining owner-machine gates. The original corpus is deliberately synthetic: it is a foundation regression suite, not evidence of quality on naturally occurring publications.
