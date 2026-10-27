# CI fixture standards review

Reviewed `git diff 200c052567367ceac03eb5d93488f4662b9e715f...80e7532ce6fd9fce10816e024b61dae994eea99b` in the isolated CI-fix worktree, including both affected tests, inherited fixtures, the PTY response implementation and the causal diagnosis.

**Findings: 0. No actionable documented-standard violations or baseline code-smell findings.**

The change is confined to two existing public CLI test files. It retains the documented framework and runtime overrides, adds no dependencies and changes no production code, shared fixture policy, timeouts or assertions about protected refs, metadata, content or checkout identity.

The local `prepareChildBeforeSibling` helper removes four copies of the same setup and states the test precondition directly. Its dates are relative to the actual parent committer date, not the wall clock or a fixed future year. It restores the inherited `GIT_COMMITTER_DATE` value in `finally`, including the distinction between absent and present environment values. The independent Git ordering assertion makes an invalid setup fail explicitly before the hook scenario runs.

The rotation scenario now selects the intended branch by its unique name and waits for the visible completed filtered selection before pressing Enter. Removing `FORCE_COLOR` is scoped to the disposable fixture environment; the existing no-color policy makes that acknowledgment stable. No sleeps, retry-to-luck, internal mocks or relaxed outcome checks were introduced.

All new comments and metadata are English. The timestamp setup in the rotation case and the helper serve different scenario preconditions; a cross-suite date abstraction would add machinery without improving this narrow correction.

This was a read-only standards review. I did not rerun the tests; the parent owns the recorded controlled-clock and complete affected-file Node/native execution gates.
