# Spec review: inherited CI fixture corrections

Reviewed `200c052567367ceac03eb5d93488f4662b9e715f...80e7532ce6fd9fce10816e024b61dae994eea99b` against #1's safety and regression scope.

**No actionable spec findings.**

The spec requires existing shared-renderer consumers to retain their contracts and calls for deterministic Git fixtures rather than assumptions about branch ordering. These two test-only changes meet that boundary without changing production behavior or the log depth policy.

The freeze setup establishes both siblings ahead of their parent by actual committer date, preserves the inherited date setting and verifies the fixture ordering independently with Git. This fixes the demonstrated dependency-deferral asymmetry while retaining real pre-rebase, post-rewrite and reference-transaction hooks. The original assertions still require late freeze refusal, preservation of protected refs/metadata and contents, retention of an already-completed rewrite, and successful recovery after unfreeze.

The rotation scenario still uses a real terminal and verifies the actual destination parent, changed child history, stack metadata and restored departure. Typing the unique target name and waiting for completed filtering replaces positional Up-key assumptions. The deliberately changed trunk/date layout preserves the causal reproduction instead of merely relying on the local ordering that previously passed. Color removal is fixture-local; no general renderer/pager/interaction policy changes or added sleeps/retries are present.

The recorded diagnostic failures reproduce on the hash-verified 0.1.1 baseline. Node/native validation retains all 32 affected file scenarios and all five controlled-clock scenarios with matching identities and zero skips. Final CI on the pushed integration commit remains the parent verification gate; it is not claimed passed here.

Findings: **0**.
