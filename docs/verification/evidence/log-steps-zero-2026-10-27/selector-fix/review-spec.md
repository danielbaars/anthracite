# Spec review: move-selector fixture correction

Reviewed `f89ef82fcaa7e8ebb955ff331cc3519009ff7762...f1f24e50e75caa096437837a429ef3cb04b982ff` against #1's shared-consumer regression and scope requirements.

**No actionable spec findings.**

The spec requires existing interactive branch selection to retain its contract and rejects expected results based on incidental sibling ordering. The three changed successful interactions intend a branch identity (`other`), not a specific keyboard position. Typing that identity and waiting for the completed filtered suggestion preserves the real PTY boundary and avoids confirming the previous suggestion before asynchronous filtering completes.

The adversarial leaf fixture retains the causal newer-trunk/date-tie condition. Restacking the destination onto that trunk before the observation window isolates the original expected-other/actual-main failure without relaxing the existing own-history assertion. The recorded controlled failure reproduces that exact assertion on both the candidate and the independently hash-verified 0.1.1 baseline.

All original departure/source, excluded-descendant, preserved-ref, commit-content and parent-navigation assertions remain intact. Cancellation and invalid-input cases are unchanged. FORCE_COLOR removal affects only the three successful fixture interactions; production rendering, shared fixture configuration, runtime timeouts and actual arrow-navigation coverage are untouched. The bounded selector audit supports this scope rather than a blanket rewrite of unrelated terminal tests.

The complete file records matching Node/native scenario identities at 9/9, and the fixed-clock/forced-color driver records all three successful scenarios at 3/3 on each runtime, without skips. Final CI on the updated integration head remains the parent's verification gate and is not claimed passed here.

Findings: **0**.
