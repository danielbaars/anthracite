# Move-selector fixture standards review

Reviewed `git diff f89ef82fcaa7e8ebb955ff331cc3519009ff7762...f1f24e50e75caa096437837a429ef3cb04b982ff`, the complete affected test file, the inherited fixture environment and public PTY response implementation, plus the causal diagnosis and provenance.

**Findings: 0. No actionable documented-standard violations or baseline code-smell findings.**

The change is limited to one existing public CLI test file. `selectOther` extracts three identical successful interactions without introducing a generic selector framework or changing cancellation, refusal or intentional keyboard-navigation coverage. It names the actual target rather than depending on incidental graph order.

The helper waits for the completed filtered prompt and selected-row marker before Enter, not merely the typed query or pending suggestion. Clearing `FORCE_COLOR` affects only the disposable fixture environment, whose existing no-color setting then applies. It does not mutate process-global environment or shared test policy.

The adversarial leaf setup uses dates relative to the actual base commit and restores an inherited `GIT_COMMITTER_DATE` value in `finally`, including restoring absence. Aligning `other` through the public restack command preserves the original own-history assertion while retaining the demonstrated wrong-target ordering condition. Original ref, ancestry, checkout and navigation assertions remain intact.

All new comments and metadata are English. No production changes, dependencies, sleeps, retry-to-luck, timeout increases, internal mocks or outcome weakening were introduced. The small date setup remains local to the one scenario that requires it; no additional abstraction is justified.

This was a read-only standards review. I did not rerun tests; recorded complete-file and controlled-clock Node/native acceptance remains with the parent workflow and its subsequent CI gate.
