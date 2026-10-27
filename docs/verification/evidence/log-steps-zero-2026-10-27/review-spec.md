# Spec review

Reviewed `2cf7bd6a8fc99dc8c73896038e0c8add8ef3539f...9c14f9738b662391c78c412d410306993a0e6c69` against Anthracite #1 and sub-issues #2–#5.

**No actionable spec findings.**

The implementation distinguishes explicit zero from omission in both entry handlers, excludes both ancestor and descendant nodes, and suppresses connectors for hidden children without changing positive-depth traversal. Existing aliases use those handlers. The bounded non-classic zero-log runner path validates the physical checkout before a recovery override can substitute another branch, and uses existing inspection-preserving contexts to retain durable metadata and continuation contents. Classic, long and other commands retain their existing paths.

The public subprocess suites cover all seven routes, the four zero spellings, both recorded graph shapes and additional fanout, full/short style differences, branch states, refusal diagnostics, dirty work/cwd/linked worktrees, real recovery, stack/reverse/untracked/classic/long options, actual pager input and pager failure/early exit. Expected graph identities and preservation observations are independent of the renderer. Per-ticket evidence records matching Node/native scenario identities without skipped focused cases; genuine product reds are distinguished from characterization and an oracle-authoring correction.

The combined final integration run and required project checks remain the parent acceptance gate. Per-ticket passing results are not substitutes for that gate, and this review does not claim those still-running checks have passed.

Findings: **0**.
