# Genuine file-split conflict and minimal recovery context

Read-only source analysis, 28 October 2026; no runtime verification or canonical edits. Product source baseline: `3923b1088b29f02ce9d9e2d8da9fb52339889915`.

## Valid conflict fixture

A clean, already-restacked child starts on the source tip tree. File splitting preserves that source tip tree, so replacing its parent with an identical tree does not itself introduce an ordinary content conflict. A conflict test must establish a genuine replay dependency rather than inject a mock error.

Use an already-stale tracked descendant:

1. Base `P` contains `shared.txt = base`.
2. Tracked source `feature` at `F1` modifies another path `selected.txt`; create tracked `child` from `F1`.
3. Child commit `C1` changes the same single line of `shared.txt` to `child`.
4. Switch to `feature` and create `F2` changing that line to `source`, without restacking the child. A direct Git commit is sufficient for fixture setup. Child metadata still names `feature` and records parent revision `F1`.
5. Run file split on `feature`, selecting only `selected.txt`. Extraction is nonempty; source remainder contains `shared.txt`. Source tree after extraction is exactly `F2`'s tree.
6. Mandatory child replay is `git rebase --onto <rewritten-feature> F1 child`, and genuinely conflicts applying `base → child` over `source`. Inspect actual unmerged entries/rebase state; resolve and stage `shared.txt`; invoke fresh-process `an continue`. Verify extraction is not repeated, remaining descendants replay in parent-first order, unrelated refs remain unchanged, and final checkout returns to `feature`.

This graph is accepted by existing source logic:

- [`validateOrFixParentBranchRevision`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/parse_branches_and_meta.ts#L206) marks a branch `VALID` when stored parent revision is in its history. `F1` is in the child's history; `F2` is not. The conditional repair requires current parent to be in the child's history, so it retains `F1`. Stale tracking is distinct from invalid tracking.
- [`getChildren`/recursive traversal](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/engine.ts#L303) includes `VALID` children; [`getRelativeStack`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/engine.ts#L750) uses that traversal.
- [`isBranchFixed`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/engine.ts#L284) compares stored parent SHA with current parent SHA; stale child is unfixed. [`restackBranch`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/engine.ts#L1149) rebases from that stored parent SHA onto current parent SHA.

The conflict outcome above is a deduction from those Git inputs, not a newly observed runtime result. Scope the old-descendant-tree equality assertion to initially restacked, nonconflicting fixtures. Stale descendants intentionally incorporate intervening parent changes, and user conflict resolution can change their final trees.

## Minimal durable recovery addition

Existing continuation fields already carry return source (`currentBranchOverride`), remaining replay queue (`branchesToRestack`), active target base (`rebasedBranchBase`) and ownership (`rebaseOwnership`); [`persistContinuation`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/actions/persist_continuation.ts#L5) and [`continueAction`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/actions/continue.ts#L30) can supply actual rebase continuation. Successful engine replay returns to cached original source.

Those fields alone do not identify a mandatory split operation. [`frozen_branch.ts`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/lib/engine/frozen_branch.ts#L15) and [`restackBranches`](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/actions/restack.ts#L77) recognize move/fold/insert/reorder; an unrecognized file split can silently skip newly frozen descendants during restart. A backward-compatible optional split operation role (or equivalent explicit durable marker) therefore needs integration with mandatory participant lookup, completed-branch recording, diagnostics and cleanup. Reuse existing queue/base/ownership/return fields. Minimal extra semantics are source identity plus mandatory/completed participants; extracted parent identity is useful for diagnostics but may be derivable. No saved patches, universal transaction log or rollback subsystem is justified by this slice.

Only promise `continue` for an actual persisted active rebase. Pre-rebase hook failure without rebase state requires explicit remaining `an restack --branch ... --only` recovery commands in dependency order and final checkout; restarting split would repeat extraction. Completed extraction and replay remain after `an rebase --abort`. Preserve legacy optional-field compatibility. Post-hook work and changed protection must be rechecked at existing managed checkpoints, including before `continue --all` stages anything.
