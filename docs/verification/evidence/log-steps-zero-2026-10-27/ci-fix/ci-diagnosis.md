# CI fixture diagnosis

The CI failures were reproduced through the existing built public CLI tests, without changing production code or weakening guard, ref, parent or content assertions.

## Freeze hook timing

The two original CI cases are selected with Mocha grep:

`retains an actual completed move rewrite|guards local DELETE parent metadata`

The ordinary local native run passed both. Setting external `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` to `2026-01-01T00:00:00Z` made both fail with the original CI symptoms. The same controlled-clock command also failed both cases against the pinned Anthracite 0.1.1 baseline, whose SHA-256 was independently verified as `6b81017ae0b7cb018c698fd5e25c074d15aed726bcbe2451cab2c6864999091e`. Fixing only author date passed both cases. These failures therefore predate the zero-depth log correction and depend on fixture committer ordering.

An independent public Git/date and CLI-output probe demonstrated the causal sequence. Child retained its explicit 2030 committer date across the preparatory restack, falsifying the hypothesis that restack erased that date. The sibling still tied its parent. The post-rewrite hook did execute, but actual move output was:

```text
Restacked base on other.
Restacked z-sibling on base.
Restacked child on base.
Restacked tip on child.
```

Thus the hook froze an already-completed sibling. The cache seed sorts committers newest first, then resolves parent dependencies. With equal parent/sibling times, child can be deferred twice while the sibling is deferred only once. Moving only child's date into the future did not establish the required child-before-sibling scenario.

The narrow fixture correction sets both sibling committer dates relative to their parent's actual date (sibling +1 second, child +2 seconds), restores any inherited date setting and checks the independent Git ref-date order. Four existing hook scenarios share this setup. All original late-freeze and metadata/ref-preservation assertions remain intact. The previously failing fixed-clock loop is green for all four related scenarios.

## Terminal target selection

The existing rotation case submitted two Up keys and expected the `tip` branch. A newer empty trunk checkpoint plus equal base/departure committer dates deterministically changes the selector positions. With the old keys, the exact original `base^ != tip` failure reproduces on both the candidate and the pinned 0.1.1 baseline.

The corrected test types the unique branch name and waits for a completed filtered prompt and selected-row marker (`› tip` followed by the selected-row glyph) before Enter. The captured transcript distinguishes the pending `… tip` display with the old list from the completed `› tip` display with only selected `tip`. The scenario clears inherited FORCE_COLOR only for its fixture so ANSI decoration cannot interrupt that semantic acknowledgment. All original destination-parent, own-history, changed-child and departure assertions remain unchanged.

## Scope

Only the two existing test files change. There is no production change, global fixture policy change, timeout increase, sleep or retry-to-luck. The order probe is diagnostic evidence outside the source tree. Both complete affected files pass on Node (32/32) and the separately compiled native candidate (32/32), with matching scenario identities and zero skips. Controlled-clock validation of the four hook cases plus the terminal selector passes 5/5 on each runtime, including forced-color inheritance in the direct selector driver. Final source commit, binary identity, original CI reports and all runtime results are recorded in provenance.json.
