# Sync existing stacks

Existing-feature refresh and default restacking shipped in 0.6.0. The local-ahead merged-parent repair described below targets 0.6.1 and is absent from 0.6.0.

`an sync`, `an repo sync` and `an repo s` refresh the existing tracked feature graph belonging to the configured trunk. Independent stacks and local descendants are included. Sync does not discover remote-only branches, import missing parents, push branches or change GitHub PRs. Use scoped `an get` when repository-wide selection is unwanted.

## Phase order

Sync snapshots the graph and sources and collects required choices before applying local changes. It then updates trunk, refreshes eligible open-PR feature heads parent-first, performs separately approved cleanup, maintains affected local histories and restores the original checkout. Read-only GitHub lookups, fetches, PR information and owned source pins can occur during planning; this is not a write-free transaction.

The candidate fix for [#139](https://github.com/danielbaars/anthracite/issues/139) separates fresh terminal status from coverage of current local work. Sync prefers a unique current open PR after branch-name reuse. A validated historical association may still refresh its recorded status, but a closed/merged PR authorizes cleanup only when its head exactly matches the local head being removed. Later unpublished commits are retained, including with `--delete-all` or sync `--force`. Independent existing local empty/merged proof remains available, including without GitHub integration. Known missing coverage is reported rather than treated as an open PR. Existing published 0.6.11 does not include this correction.

A closed or merged PR is a cleanup input rather than a feature-refresh source. Declining cleanup retains that branch without preventing inspection of its descendants. Local-only work stays unpublished. With GitHub integration disabled, sync makes no service calls and retains local trunk/cleanup/maintenance behavior; cached PR status is not fresh verification.

When GitHub retargets an open child to trunk after its parent PR merges, sync preserves a strictly local-ahead child whose remote commits are already contained locally. It keeps the original local replay boundary for cleanup and maintenance instead of asking to replace the child with the older remote head. Cleanup still follows the selected delete options; no-restack still defers replay. This narrow case requires the old local parent to match the freshly verified merged PR head. Divergence, a closed/unmerged parent and other parent changes retain existing explicit reconciliation. See the [repair verification](verification/sync-merged-parent-local-commits-2026-11-02.md).

## Options and authority

|Option|Meaning|
|---|---|
|`--pull` / `--no-pull`|Default true. Controls trunk fetching/application only; no-pull still permits feature refresh and PR information lookup.|
|`--delete` / `--no-delete`|Default true. No-delete suppresses cleanup even with delete-all or force.|
|`--delete-all`|Default false. Supplies confirmation only for already eligible local cleanup; it grants no trunk reset or feature-overwrite authority.|
|`--restack` / `--no-restack`|Default true. Controls automatic local maintenance; no-restack retains incoming updates and approved cleanup/parent changes, and names pending repair.|
|`--force`|Retains separate sync trunk-reset and cleanup-consent powers. It does not authorize silently overwriting divergent feature work.|

Existing `-p`, `-d`, `-r`, `-f` and progress options remain available. Explicit boolean forms follow the same rules across all three routes. No new refresh switch or persistent preference is introduced.

```sh
an sync --no-delete                  # refresh and maintain, retain cleanup candidates
an sync --no-pull --no-restack        # refresh features; retain trunk and defer automatic replay
an sync --delete-all --no-interactive # unattended eligible cleanup, without granting trunk reset
```

These are active update workflows. There is no exact flag recipe for the former trunk/PR-information-only default. This deliberately changes the former local-ahead no-op: local-ahead or divergent trunk now refuses without explicit force or affirmative terminal reset consent; inspect unique trunk commits before authorizing that reset. Get retains its separate fast-forward-only trunk contract even with feature force.

Divergent feature heads require an explicit terminal rebase/overwrite/abort choice; unattended execution refuses before planned head changes. No-restack does not cancel a separately chosen reconciliation rebase. Frozen inbound fast-forwards can retain frozen status; frozen history is not locally replayed. A mandatory frozen survivor can prevent its cleanup group even with no-restack. Unrelated safe cleanup may still proceed.

## Local work and completion

Sync conservatively refuses tracked dirt and protects untracked/ignored collisions and physically affected worktrees. It preserves authors, full commit messages and surviving branches' own changes during replay. Already-valid histories are not rewritten gratuitously.

On complete success, the original branch is restored at its authorized current tip, or the exact original detached commit is restored. If this operation actually deleted the original branch through approved cleanup, trunk is the reported fallback. An unexpectedly missing branch is an error, not fallback permission. Final graph and physical-checkout checks run after checkout hooks and source cleanup; a late mismatch preserves reached work and concurrent state and reports failure.

## Conflicts and inspection

Resolve a genuine owned Git conflict in the original project and run `an continue` (alias `cont`); `--all` may stage resolved work only after ownership and participant protection checks succeed. A fresh process uses the saved sources, parents, choices, cleanup consent and checkout policy. It does not fetch newer feature heads or broaden the plan.

When cleanup is still pending, continuation freshly verifies the exact saved PR identities and states. A reopened/mismatched PR or failed lookup refuses advancement. If that verification requires GitHub and integration has been disabled, restore read access or inspect/replan; cached status cannot substitute. Purely local cleanup eligibility needs no PR read.

A raw Git abort cancels only its active rebase, not earlier updates, deletions or completed rewrites. Foreign, changed, stale or missing ownership must not consume another workflow's state or execute an unchecked queue. A non-conflict interruption or uncertain completed publication or a saved record without a matching active rebase requires guarded manual inspection; automatic retry and general rollback are not promised. Some source pins may already have been removed when a late check fails.

Finish a pending new sync workflow before downgrading. Existing get, structural, landing and legacy continuations retain their own contracts. MCP uses the existing learn_an/run_an_cmd tools with literal arguments and an explicit cwd; process cancellation does not imply atomic undo.

See [candidate verification](verification/sync-updates-implementation-2026-11-01.md) for bounded local acceptance and the retained historical [Graphite comparison](https://github.com/danielbaars/anthracite/blob/78937d87424a331de34c2cf3cf95a8944c8d6ff5/docs/verification/get-sync-parity-2026-10-31.md). Multi-trunk selection and remote-only discovery remain separate work.
