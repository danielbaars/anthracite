# Get and sync parity: Graphite 1.8.6 and Anthracite 0.5.0

Research date: **31 October 2026**. Anthracite source is pinned to [v0.5.0, commit `609fb557`](https://github.com/danielbaars/anthracite/tree/609fb557d4b6a429d91f500169c596592139d9d1). The selected Graphite execution target is the installed **1.8.6** artifact. Official Graphite pages below were read on the research date and are **current, unversioned documentation**, not an immutable 1.8.6 specification.

The documentation/source sections below are distinct from the new **LIVE** observations. The [evidence ledger](evidence/get-sync-parity-2026-10-31/ledger.json) records exact command inputs and before/after states. This is bounded research, not complete parity, universal safety or an implementation specification.

## Documentation findings

Graphite currently describes `get` as fetching ancestors plus locally present descendants when the target already exists; remote-only descendant discovery is separate. Its collaboration guide recommends `sync` for remote changes to existing branches and `get` for new branches, and documents divergence choices and frozen imports. These are useful probe hypotheses, not new observations of 1.8.6. [Command reference](https://graphite.com/docs/command-reference), [collaboration guide](https://graphite.com/docs/collaborate-on-a-stack).

| Interface | DOC: current advertised role | SOURCE: Anthracite 0.5.0 |
| --- | --- | --- |
| `get --downstack` | Exclude local descendants of an existing target. | Ancestor-to-target traversal is already its only selection; no corresponding flag. |
| `get --remote-upstack` | Discover/include descendant PR information from remote. | No descendant discovery. Each selected PR supplies its base for the ancestor walk. |
| `get --restack` / `--no-restack` | Control conflict-free restacking; enabled by default. | No get restack option. A fast-forward with local children prints a restack warning. |
| `get --checkout` / `--no-checkout` | Control final target checkout; enabled by default. | Always attempts target checkout after importing/updating the selected chain. |
| `get --delete-all` | Bypass cleanup confirmation for merged/closed branches. | No cleanup phase in `getAction`. |
| `sync --all` | Include every configured trunk. | A single configured trunk; no all-trunk model or flag. |
| `sync --delete-all` | Bypass merged/closed branch cleanup prompts. | Existing `--force` can bypass deletion prompts but also authorizes trunk reset. |

DOC sources: [command reference](https://graphite.com/docs/command-reference), [multiple-trunk guide](https://graphite.com/docs/multiple-trunks#syncing-branches-across-trunks). SOURCE: [get builder](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/commands/get.ts), [get action](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/get.ts), [sync builder](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/commands/repo-commands/repo_sync.ts), [single-trunk configuration](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/lib/spiffy/repo_config_spf.ts).

`sync --all` therefore belongs to the existing multi-trunk decision G05, rather than being an isolated single-trunk “sync everything” flag. The multiple-trunk guide distinguishes the default current-trunk scope from explicit all-trunk scope. [Multiple-trunk guide](https://graphite.com/docs/multiple-trunks#syncing-branches-across-trunks), [parity register](../graphite-parity.md).

Graphite's current configuration guide also offers persistent automatic cleanup for `get` and `sync`. A cleanup preference is different from granting overwrite permission. Its sync guide describes best-effort restacking and conflicts requiring deliberate resolution. [Configuration](https://graphite.com/docs/configure-cli#sync-settings), [sync guide](https://graphite.com/docs/sync-with-a-remote-repo).

The worktree guide explicitly applies to version 1.8.4 and above: it describes skipping non-trunk branches occupied elsewhere, with a trunk-update exception. It also warns that commands may need to run separately from each relevant worktree. This narrows useful 1.8.6 probes but is not itself execution evidence. [Worktree guide](https://graphite.com/docs/multiple-worktrees).

## Anthracite source findings

### Get selection, imports and local changes

`getAction` interprets an all-digit argument as a PR number, resolves its head name, and walks PR base names until the configured trunk, detecting cycles. It requests `gh pr view` against the configured owner/repository. Although failure prose refers to open PRs, `prFieldMaybe` requests only `baseRefName` and does **not** inspect PR state. Closed-target behavior must therefore be measured rather than inferred from that prose. [Get action](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/get.ts), [repository identity](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/lib/api/github_repo.ts).

Existing tracked branches retain their frozen status. New imports are frozen unless their author matches the verified current GitHub user, or `--unfrozen` is supplied. Selected branches are fetched and updated in order: already-matching, new/forced overwrite, locally untracked, changed parent, fast-forward and divergence paths are distinct. Divergence aborts without interactive input; the interactive same-parent path offers rebase/overwrite/abort, while frozen branches exclude local rebase. `--force` selects overwrite rather than proving preservation of local-only commits. Earlier successful updates may be retained when a later participant fails. [Get action](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/get.ts).

The source does not pull trunk as part of `getAction`. Its engine uses local parent/trunk identities to derive fetch boundaries, and fast-forward/import paths temporarily check out selected branches before the final target checkout. A future no-final-checkout option would not automatically establish a no-checkout-at-any-stage or dirty-worktree-preserving contract. [Get engine paths](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/lib/engine/engine.ts), [fetch helper](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/lib/git/fetch_branch.ts).

### Sync selection, cleanup and force

The public sync builder defaults `pull` and `delete` to true, `restack` and `force` to false. `syncAction` rejects uncommitted tracked changes, optionally pulls trunk, refreshes PR information for tracked branches, optionally cleans branches, then optionally restacks. It explicitly reports that feature-head refresh belongs to `get`. Its restack set combines the current stack with affected stacks after cleanup; when run on trunk it can include every tracked stack. This is narrower than assuming every invocation restacks every branch. [Sync builder](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/commands/repo-commands/repo_sync.ts), [sync action](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/sync.ts), [PR refresh](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync_pr_info.ts).

Cleanup begins at trunk children and descends **only through accepted deletion candidates**. An open or declined ancestor can stop searching that arm; a closed child above it is not automatically proven reachable by cleanup. Existing associated CLOSED/MERGED states, local merge detection and empty-branch handling feed eligibility. Noninteractive cleanup without force declines candidates. Frozen mandatory survivors can exclude cleanup; worktree guards apply to deleting/replaying groups. Source alone establishes a reachability hypothesis; live case C23 below supplies the reproduction. [Cleanup](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/clean_branches.ts), [eligibility and survivors](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/delete_branch.ts).

If trunk cannot fast-forward, `pullTrunk` requires interactive confirmation or `--force` before resetting it to the remote revision. Consequently, using `sync --force` as an automation substitute for narrow cleanup consent also grants a potentially destructive, separate permission. Do not advertise it as a semantic alias for Graphite's documented cleanup-only `--delete-all`. [Sync/pull action](https://github.com/danielbaars/anthracite/blob/v0.5.0/apps/cli/src/actions/sync/sync.ts).

## Original probe questions

1. Does installed Graphite 1.8.6 refresh local descendants and remote-only successors as its current documentation describes? Compare the resulting branch set, actual OIDs, parents and checkout with Anthracite, including fanout.
2. Which existing heads does each `sync` refresh, and what restacks by default versus explicit flags? Keep trunk advancement, remote feature replacement and local replay separate.
3. What is the actual cleanup scope for merged/closed branches below and above open parents? Record prompt decisions and retained local commits, not merely exit status.
4. How do dirty tracked work, frozen branches and occupied worktrees change selection, failures and partial effects? A skipped participant and a refused whole command are different results.
5. What does `--no-checkout` preserve after intermediate updates, and does a narrow cleanup flag remain narrow when trunk diverges?

The strongest source-led priorities are default/local-upstack get scope, existing remote-head refresh during sync, automatic restack behavior and cleanup consent separated from overwrite consent. Remote-only discovery needs a separate standalone design decision if installed Graphite relies on hosted submission metadata. Multi-trunk `--all` remains tied to G05. These were the source-led probe priorities; the measured results below determine which are confirmed. They do not approve implementation.

## Measured live results

**35 scenario-command observations** were retained: 32 on normalized consumers and three initial native-unsubmitted observations. These are not test-pass counts. Six separate controlled-gh Anthracite controls corroborate local behavior; they are not added to the live count. The selected native Graphite SHA-256 is `9153b4b6d9ad8084ec700a1fb80dd8a4b35c08c3116bf41f1fcdd792b326781f`; the public Anthracite bundle is `da14fac871faab60336d4fd541821f85d9b99a98a13e9d159a3a3aaf2c98ee1a`, running on Node 24.19.0/macOS ARM64. REA 6.7.0 captured actual commands. [Full identities and cases](evidence/get-sync-parity-2026-10-31/ledger.json).

The approved real GitHub fixture was `main → base → child → tip`, with sibling below base. The first raw-GitHub-seeded Graphite consumer returned 0 while skipping the changed child because it had never been submitted/synced with Graphite. That is retained as a precondition-sensitive result, not a successful refresh. Actual native `get child --force --downstack --no-restack` and Anthracite `get child` then established matching local heads at child `67a223e`. A second normal remote fast-forward advanced child to `df5b85e`. Fresh copies retained each product's native initialized metadata. No private planner/engine metadata was injected. The tip was already behind its updated parent; that known restack need is part of the input.

| Area / cases | LIVE: Graphite 1.8.6 | LIVE: Anthracite 0.5.0 | Conclusion |
| --- | --- | --- | --- |
| Existing local upstack, G11/G12 | `get base --no-restack` advances child to df5; adding `--downstack` leaves child at 67a. | Ordinary `get base` leaves child at 67a. | Real selection/refresh gap; current Anthracite scope overlaps the bounded Graphite downstack case. |
| Existing heads during sync, S11 | `sync --no-restack` advances child to df5. | Same explicit restack-disabled mode refreshes PR data but retains child at 67a. | Missing feature-head refresh, separate from restack. |
| Restack, G15/S12 | Default get and default sync replay tip; its unique tip.txt blob survives and child.txt contains the remote correction. | Get has no corresponding phase/option; sync's default false is SOURCE/help evidence. | Two real Graphite restacks; S12 is not a paired Anthracite-default runtime test. |
| Final checkout, G14 | Explicit `--no-checkout` updates child while retaining the base checkout/index/files in this clean fixture. | Ordinary get updates and checks out child. | A demonstrated control gap, not proof of arbitrary dirty-state safety. |
| Get after merge, C22 | Advances trunk to 6f65549, removes the selected merged ancestor, updates child; reparents an unselected closed sibling without deleting it. | Normal noninteractive get refuses the changed parent. A separate fresh forced get updates child but leaves trunk at 690c12f and retains old branches. | Integrated trunk/cleanup/parent handling is missing; forcing get does not provide it. |
| Cleanup below an open ancestor, C23 | Deletes the known closed tip15 below open child14. | PR15 is genuinely cached OPEN before and refreshed CLOSED afterward, but its local branch survives under OPEN14. | **Confirmed Anthracite cleanup traversal defect**, not an unknown association. |
| Narrow cleanup consent, D21 | `sync --delete-all` refuses divergent trunk with exit 1 and preserves its own local-only trunk commit. | Available `--force` returns 0 and resets trunk to remote, removing its local-only commit from main ancestry. | Not equivalent grants: add narrow cleanup consent rather than advertising force as an alias. Force itself behaves as documented. |
| Remote-only discovery, G13 | `--remote-upstack` did not import the absent tip/sibling in this GH-seeded fixture. | Neither was imported. | **Unresolved** for native-submitted/indexed stacks. Do not infer parity or a Graphite bug. |

The first unassociated closed-sibling observation C12 is deliberately weaker: the Anthracite branch lacked PR info before and after, so it cannot isolate the traversal defect. C23 instead reuses actual OPEN associations produced by S11 before closure; immutable metadata ref identities establish that provenance. C21 is a positive control: both tools remove known merged base13 and closed sibling16 when the deletion traversal reaches them. Graphite also updates the remaining child; Anthracite does not. [Independent cleanup/consent audit](evidence/get-sync-parity-2026-10-31/audits/cleanup-live-audit.md).

### Protection and uncertainty

- Both tools update the frozen child and retain frozen status in P12; independent read-only SQLite/ref inspection confirms it. This is supported inbound-update behavior, not a frozen-branch gap.
- In P11 Graphite retains one unrelated modified README while updating/checking out child; Anthracite refuses tracked dirt. This does not establish safety for arbitrary staged, overlapping or untracked work.
- Both return 1 for the occupied target in P13 with local heads retained. Graphite first skips its update, then fails final checkout; its requesting index changes. No early all-or-nothing refusal or complete foreign-worktree byte preservation is claimed.
- Both preserve their own local-only feature commits in D11. Graphite warns/skips with exit 0 and checks out child; Anthracite refuses with exit 1 and remains on main. The local-only commits intentionally differ; the divergence pattern is equivalent, not byte-identical.
- Fetch-related refs/cache/index can change on refusal. D21 Graphite specifically writes fetch/tracking refs before refusing trunk reset. Neither a nonzero exit nor unchanged user-facing heads establishes zero writes.

The [independent core audit](evidence/get-sync-parity-2026-10-31/audits/live-audit.md) checks paired preconditions, restack content and frozen-after state. Cross-tool raw index hashes differ; snapshot coverage is local heads, Anthracite metadata, current worktree/index and selected REA filesystem paths, not every cache/recovery byte or syscall. No actual replay conflict, interrupted get/sync recovery, arbitrary dirty work, multi-trunk run, native-submitted remote discovery or other platform is certified.

## Concrete next work

1. **Small correctness fix:** make sync cleanup inspect known closed descendants below open ancestors (C23). This is separate from adding Graphite flags.
2. **Next feature specification:** explicit get selection and final-checkout control: retain a deliberate compatibility/default decision, add local-upstack versus downstack selection, and define `--no-checkout`. Include safe trunk fast-forward and a separately selectable restack phase; do not silently combine cleanup/reset authority.
3. **Then sync:** refresh existing selected feature heads through the same verified update contract, add narrow cleanup consent independent of force, and explicitly decide restack defaults.
4. Keep `sync --all` with multi-trunk G05. Keep remote-only discovery U01 pending a native-submitted/service investigation or an explicit standalone GitHub-base discovery design. Do not turn unmeasured hosted behavior into a dependency of the local tool.

This research does not approve implementation, a specification, tickets or an issue. The useful behavior gaps are now concrete enough to propose the next bounded specification without another whole-command inventory.

## Fixture completion and retained evidence

The user approved four private fixture PRs and their lifecycle. Base13 was ready/rebase-merged; sibling16, tip15 and child14 are closed without merging. Approved English titles/body cores remain intact, with no review requests or linked issues. All four remote fixture branches and the private repository remain. [Final scoped GitHub readback](evidence/get-sync-parity-2026-10-31/github/final-fixtures.json), [retained heads](evidence/get-sync-parity-2026-10-31/github/final-heads.json), [zero Actions](evidence/get-sync-parity-2026-10-31/github/actions.json).

Real gh/GitHub responses were used for the live cases; the credential wrapper only restores HOME for gh's existing macOS credential access. Tested CLI configuration was isolated, credential values were never recorded and private copies are excluded from retained evidence. Earlier missing-auth, bare-origin inference and helper failures/timeouts remain setup diagnostics, not product defects. No CLI installation, shell completion, MCP registration, CI/full matrix or release was changed.

[Retained evidence](evidence/get-sync-parity-2026-10-31/README.md) links raw captures/snapshots, immutable source receipts, independent audits and the separately labeled [controlled-gh checks](evidence/get-sync-parity-2026-10-31/controls/offline-an-results.md). The byte-copy inventory and checker validate retained artifacts; they do not rerun the CLI or turn observations into universal acceptance.
