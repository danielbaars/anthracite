# Sync existing stacks

Existing-feature refresh and default restacking shipped in 0.6.0. The local-ahead merged-parent repair described below targets 0.6.1 and is absent from 0.6.0.

`an sync`, `an repo sync` and `an repo s` refresh the existing tracked feature graph belonging to the configured trunk. Independent stacks and local descendants are included. Sync does not discover remote-only branches, import missing parents, push branches or change GitHub PRs. Use scoped `an get` when repository-wide selection is unwanted.

## Phase order

Sync snapshots the graph and sources and collects required choices before applying local changes. It then updates trunk, refreshes eligible open-PR feature heads parent-first, performs separately approved cleanup, maintains affected local histories and restores the original checkout. Read-only GitHub lookups, fetches, PR information and owned source pins can occur during planning; this is not a write-free transaction.

The candidate fix for [#139](https://github.com/danielbaars/anthracite/issues/139) separates fresh terminal status from coverage of current local work. Sync prefers a unique current open PR after branch-name reuse. A validated historical association may still refresh its recorded status, but a closed/merged PR authorizes cleanup only when its head exactly matches the local head being removed. Later unpublished commits are retained, including with `--delete-all` or sync `--force`. Independent existing local empty/merged proof remains available, including without GitHub integration. Known missing coverage is reported rather than treated as an open PR. Existing published 0.6.11 does not include this correction.

The candidate for [#171](https://github.com/danielbaars/anthracite/issues/171) preserves ordinary same-parent local-ahead work when the freshly verified remote head is already contained in the local branch. It reports unpublished local commits and a bounded submit preview, rather than offering to replace them with the older source. The incoming-refresh decision retains the local head and replay boundary; separately required local maintenance can still rewrite it. Sync does not publish that history. Get keeps its existing reconciliation behavior. Public npm 0.7.0 does not include this correction.

Preservation keeps the captured remote source and participant guards in the saved sync plan. Existing released records retain their original choices; new optional preservation decisions require a compatible candidate. Finish or deliberately abandon that sync before downgrading. No branch-metadata migration or stored last-published-head claim is introduced. Different or uncertain histories still require deliberate reconciliation; the explanation describes differing history without assuming who changed remote.

The candidate also recognizes a branch restacked onto a verified newer trunk base when its ordered branch-owned commits retain identical changes, author identity/time and complete message bytes. Its children can be recognized through the already verified parent's exact remote and local heads, including longer chains and fanout. A matching name or proof from another arm is insufficient. It reports matching branch work and pending publication, preserving local tips without pushing; independent incoming branches still refresh and required local maintenance still runs.

Matching aggregate diffs, stable patch IDs or message prefixes alone are insufficient. Changed whitespace, binary data, modes, paths, authorship, messages, order or additional commits retain deliberate reconciliation. The proof is bounded to 128 commits per history, 4 MiB of read output and three seconds; unsupported merge/header/encoding shapes (including signed or extra-header commits), contextual differences and exhausted limits remain uncertain. Git display preferences cannot hide committed files or gitlinks from the comparison, and replacement/graft ancestry cannot establish local containment or equivalent restacking.

A clean local `an ls` means local parent relationships are consistent; it does not mean those rewritten heads are published or that their PRs are mergeable. Inspect the bounded preview printed by sync, for example `an submit --branch child --dry-run`, before separately authorizing publication. Different or unproven histories still offer deliberate rebase/overwrite/abort choices in a terminal and refuse unattended reconciliation.

Saved preservation uses an optional sync-only `refresh.preserved` list; the captured sources remain pinned. A fresh `continue` retains that decision rather than fetching newer heads or reconsidering an explicit saved rebase/overwrite choice. Unmodified recovery produced by public npm 0.7.0 remains supported. Conversely, that released reader strictly rejects a candidate record containing preservation before staging or consuming recovery; it does not silently discard the new decision. Use the compatible CLI to finish or abandon it. Get's separate recovery contract is unchanged.

A closed or merged PR is a cleanup input rather than a feature-refresh source. Declining cleanup retains that branch without preventing inspection of its descendants. Local-only work stays unpublished. With GitHub integration disabled, sync makes no service calls and retains local trunk/cleanup/maintenance behavior; cached PR status is not fresh verification.

When GitHub retargets an open child to trunk after its parent PR merges, sync preserves a strictly local-ahead child whose remote commits are already contained locally. It keeps the original local replay boundary for cleanup and maintenance instead of asking to replace the child with the older remote head. Cleanup still follows the selected delete options; no-restack still defers replay. This narrow case requires the old local parent to match the freshly verified merged PR head. Divergence, a closed/unmerged parent and other parent changes retain existing explicit reconciliation. See the [repair verification](verification/sync-merged-parent-local-commits-2026-11-02.md).

## Options and authority

|Option|Meaning|
|---|---|
|`--pull` / `--no-pull`|Default true. Controls trunk fetching/application only; no-pull still permits feature refresh and PR information lookup.|
|`--delete` / `--no-delete`|Default true. No-delete suppresses cleanup even with delete-all or force.|
|`--delete-all`|Default false. Supplies confirmation only for already eligible local cleanup; it grants no trunk reset or feature-overwrite authority.|
|`--restack` / `--no-restack`|Default true. Controls automatic local maintenance; no-restack retains incoming updates and approved cleanup/parent changes, and names pending repair.|
|`--abort`|Candidate: ends only the owned sync locally, preserving reached work and recovery evidence. Refuses explicit combinations with other sync update/cleanup options.|
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

The candidate #139 correction also verifies that a terminal PR covers the exact local head selected for each remaining deletion, before `continue --all` stages files or advances the active rebase. Completed deletions are not selected again. Older version-1 records do not need migration: fresh evidence can establish unchanged safe coverage without the optional saved PR-head field. If coverage is missing or changed, continuation preserves local work, index and recovery rather than completing the rebase first. Inspect the retained plan and commits; do not edit ownership, delete recovery or reset refs to force it through. Already completed effects remain completed.

A raw Git abort cancels only its active rebase, not earlier updates, deletions or completed rewrites. Foreign, changed, stale or missing ownership must not consume another workflow's state or execute an unchecked queue. A non-conflict interruption or uncertain completed publication or a saved record without a matching active rebase requires guarded manual inspection; automatic retry and general rollback are not promised. Some source pins may already have been removed when a late check fails.

### Abandon an owned sync (candidate)

The candidate for [#152](https://github.com/danielbaars/anthracite/issues/152) adds:

```sh
an ls                              # preserving inspection of supported pending sync
an sync --abort --no-interactive    # end only that sync, without rollback
```

Public npm 0.6.14 does not provide this exit. The candidate supports its unchanged version-1 records, including after a raw Git rebase abort or a participant's removal. It does not skip or continue missing participants; that remains [#153](https://github.com/danielbaars/anthracite/issues/153).

Abandonment works offline, with no GitHub authentication. It retains the original recovery bytes and source-pin observations in private repository-local storage, prints the archive path, quits only a matching owned active rebase and releases the owned sync gate. Existing source pins and owned autostash evidence remain available. Matching interrupted archive/release work can be retried; repeating after success is a distinct successful no-op. Foreign, malformed or replaced recovery and unrelated Git operations remain protected.

Completed updates, cleanup and rewrites stay applied. Physical HEAD, branch refs/metadata, frozen status, index and tracked/untracked files remain as reached. A quit can leave detached HEAD and unresolved index conflicts. It does not roll back, checkout, stage, replay, delete branches or resolve files. Read the report's recorded completion, current observations, pending maintenance and uncertainty separately; recorded completion is not fresh GitHub readiness. Do not combine `--abort` with explicit refresh, cleanup, force or restack options.

Full/short logs and aliases inspect supported pending sync without consuming recovery. An attached physical checkout determines the current marker; at detached HEAD a validated pending participant can anchor selection but is labelled pending, not checked out. If unavailable, selection falls back to trunk. Explicit zero depth still refuses detached HEAD. Existing branch-info/children/PR inspection retains its preserving behavior.

For an obsolete participant, inspect first, abandon the owned sync, deliberately handle remaining Git state and files, and only then consider guarded branch deletion or a new sync. A separately confirmed absence of a PR may inform that decision; unknown PR status must not be interpreted as no PR. Do not delete private recovery files to bypass the gate.

See the [specification](specs/sync-abandonment.md) and [implementation acceptance](verification/sync-abandonment-implementation-2026-11-09.md).

Finish a pending new sync workflow before downgrading. Existing get, structural, landing and legacy continuations retain their own contracts. MCP uses the existing learn_an/run_an_cmd tools with literal arguments and an explicit cwd; process cancellation does not imply atomic undo.

See [candidate verification](verification/sync-updates-implementation-2026-11-01.md) for bounded local acceptance and the retained historical [Graphite comparison](https://github.com/danielbaars/anthracite/blob/78937d87424a331de34c2cf3cf95a8944c8d6ff5/docs/verification/get-sync-parity-2026-10-31.md). Multi-trunk selection and remote-only discovery remain separate work.

## Local-work recognition acceptance

The [approved local-work specification](specs/sync-local-restack.md) defines this candidate's same-parent preservation and conservative restack recognition. Public npm 0.7.0 does not include it: consecutive syncs there can still show the generic reconciliation menu after a local restack. See the [version-pinned baseline investigation](verification/sync-local-restack-research-2026-11-11.md). Candidate acceptance must distinguish local CLI, native and installed delivery checks from that published baseline; this change adds no automatic publication.
