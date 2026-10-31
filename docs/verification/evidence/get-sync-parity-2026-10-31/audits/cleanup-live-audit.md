# Independent cleanup and consent evidence audit

This is a read-only audit of **13 distinct recorded command observations**: C11, C12, C21, C22 including the fresh forced-Anthracite control, C23 and D21. It is not a pass count and is not added to earlier audit counts. [Machine-readable findings](cleanup-live-audit.json) retain exact argv, exits, Evidence IDs, capture/snapshot hashes, recorded ref changes and selected filesystem effects. No new target/native CLI, remote request, REA operation or user/global configuration effect was performed.

## Strong closed-descendant counterexample: C23

The Anthracite C23 BEFORE snapshot genuinely retains all four PR associations from the actual S11 sync while they were open. Their metadata ref OIDs match S11 AFTER exactly; this is not a synthetic association or a new lookup by branch name. In particular, tip is associated with PR15 in state OPEN.

After `an sync --force --no-restack --no-interactive`:

- Local main has fast-forwarded to the merged-base commit `6f655498`.
- Merged base13 and closed sibling16 have been removed.
- Child14 has been reparented to main and its actual refreshed association remains OPEN.
- Tip's actual refreshed association is now PR15 **CLOSED**, its parent remains child14, and its original local head `d6541e4` remains.

The raw terminal confirms successful cleanup of base/sibling but no tip deletion. Independent current read-only Git metadata confirms PR15 CLOSED under PR14 OPEN. The paired native Graphite `sync --delete-all --no-restack --no-interactive` starts from the same local branch-head map and deletes base13, tip15 and sibling16, then updates child to `df5b85e`.

This is a supported, bounded example of a known closed descendant surviving Anthracite cleanup beneath an open parent. It matches the source traversal that only descends through accepted cleanup ancestors. It is not explained away by an unknown/uncached PR: PR15 is known before execution and CLOSED afterward. It does not establish every closed-descendant or frozen/worktree case.

## Earlier unknown-association case: C12

C12 also retained the closed sibling in Anthracite, while Graphite deleted it. However, the Anthracite sibling has no `prInfo` association in either BEFORE or AFTER. The other open branches are associated during that sync. The unknown-closed association filter and the open-ancestor traversal are both relevant possibilities; **C12 does not isolate DFS as its sole cause**. Preserve it as an unassociated-case observation, using C23 for the stronger known-closed counterexample.

## Known merged roots and get cleanup scope

C21 uses known Anthracite associations. Both tools advance trunk to `6f655498`, remove merged base13 and closed sibling16, and reparent child14 to main. Graphite additionally refreshes child from `67a223e` to `df5b85e`; Anthracite leaves it at `67a223e`. Thus root cleanup itself is demonstrably available in Anthracite; its missing feature-head refresh remains separate.

C11 Graphite `get base --delete-all --no-restack` deletes the closed sibling in its selected upstack scope and updates child. Anthracite's ordinary get does neither; it has no get cleanup phase or matching cleanup flag.

C22 narrows Graphite get with `--downstack --delete-all --no-restack`. It advances trunk, removes the selected merged ancestor base13 and updates child. It **retains** the unselected closed sibling16 but reparents it to main when the removed ancestor requires maintenance. Consequently, `--delete-all` is not evidence of global repository deletion regardless of command scope.

The ordinary Anthracite C22 get refuses the fresh parent change in noninteractive mode with unchanged local branch heads. A separate fresh `get child --force` control succeeds and updates child to `df5b85e`, but local main stays at old `690c12f`; base and sibling remain. This avoids the overclaim that get cannot update the child at all, while demonstrating that force does not supply Graphite's integrated trunk advancement/cleanup. This forced fixture is a fast-forward remote-child update, not proof that force preserves arbitrary local feature divergence.

## Cleanup consent versus overwrite consent: D21

D21 compares intentionally different available grants. Graphite `sync --delete-all --no-restack --no-interactive` refuses divergent trunk with exit1 and preserves its own local-only main commit, requesting checkout, recorded index hash and worktree hashes. Anthracite `sync --force --no-restack --no-interactive` returns0 and resets main to remote `6f655498`, removing its own local-only commit from current main ancestry. The old Anthracite commit object and main reflog entry still exist at audit time; indefinite recovery is not promised.

Both local-only commits have the same original trunk ancestor `690c12f`, but their OIDs differ. This is an equivalent divergence pattern, not a byte-identical paired local tip. These flags are **not semantic aliases**. Anthracite's force behavior follows its broad reset/deletion grant; this is a missing narrow-cleanup-consent control, not a force bug. Graphite `--force` and terminal confirmations were not tested here.

Do not describe Graphite's refusal as zero-write. Its REA filesystem effects explicitly record changed `gt-fetch-head/main` and child entries, plus loose origin/main/child ref creation. The user-facing branch/index/worktree state is preserved in this fixture, while fetch-related state changes.

## Proof limits

All conclusions above refer to the explicit commands and saved states. Local snapshots cover heads and Anthracite metadata refs, not every Git/cache/recovery byte; REA adds selected filesystem observations, not a syscall trace. Native and Anthracite metadata formats and raw index bytes differ before comparison. No blanket conflict, frozen cleanup, occupied-worktree, arbitrary dirty-work, remote deletion or rollback guarantee follows. No new implementation, issue, PR, CI or publication was created by this audit.
