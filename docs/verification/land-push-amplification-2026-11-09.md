# Landing push amplification: synthetic measurements

## Question and baseline

How many pushes does current Anthracite landing perform, and which publications could be delayed without weakening the next merge's safety checks?

The baseline is merged main [a3c9f705](https://github.com/danielbaars/anthracite/tree/a3c9f7055c7a42dfe38daee8fb843f21e1763474), including the required-versus-optional check fix from PR #163. Its CLI sources were byte-compared with the existing compiled checkout used by the probe: every CLI TypeScript source matched. The executable still reports 0.6.15 because the merged change has not been released. These observations concern that source candidate, not a claim that public npm 0.6.15 contains #163.

Only real disposable Git repositories and local bare remotes are used. Existing public CLI fixtures control the external gh responses. No real GitHub PR is created or merged, no Actions workflow runs, no user project or installation is changed, and frontend-packages is not used by the probes.

## What is counted

- **Client feature update:** a successful non-deletion push from Anthracite's worktree to an existing feature ref.
- **Client deletion:** a separate successful push removing a confirmed landed feature ref.
- **Server merge simulation:** the controlled gh adapter performs a real rebase in a disposable clone and pushes trunk. This models GitHub's merge effect; it is not an Anthracite client push.
- **PR edit:** a controlled gh invocation updating an existing PR base/body. This is neither a Git push nor a measured GitHub Actions run.

A real pre-push hook records every client push, its ref/OIDs and saved landing phase/index. The bare remote's post-receive hook independently records successful ref updates. Setup pushes happen before instrumentation. Readiness lookups, fetches and no-op publications are not counted as pushes. Final analysis matches every client ref transaction against the remote receive log, excluding the simulated server's trunk advances.

## Measurements

The retained portable probe, raw snapshots and validation receipt are linked below. Successful runs verify the selected commits' files, cleanup and original independent branch heads; no optimized implementation is used.

| Scenario                                                              | Feature-update pushes | Landed-ref deletion pushes | Total client pushes | Simulated merges | PR edits |
| --------------------------------------------------------------------- | --------------------: | -------------------------: | ------------------: | ---------------: | -------: |
| Three-PR linear chain                                                 |                     3 |                          3 |                   6 |                3 |        3 |
| Seven-PR linear chain                                                 |                    21 |                          7 |                  28 |                7 |       21 |
| Seven-PR chain + published sibling + local-only sibling, pause/resume |                    22 |                          7 |                  29 |                7 |       22 |
| Three-PR chain, conflict during first survivor replay                 |                     0 |                          0 |                   0 |                1 |        0 |

For the seven-PR chain, successful head updates after successive merges are **6, 5, 4, 3, 2, 1, 0**. Per branch, the second PR is pushed once and the seventh PR six times before its own merge. The independent branch is unchanged locally and remotely. The physical final files equal the starting target checkout's files.

This is the expected triangular pattern `(n−1)+(n−2)+…+1`, under this fixture's condition that GitHub's rebased merge changes the parent commit identity each time. Source analysis explains why unchanged reached heads can skip pushes; the formula is not a universal count for all real stacks.

### Pause, resumption and a real replay conflict

The fanout starts with the seven-PR chain, a published sibling directly under `base`, a local-only sibling under `base`, and the independent `other` branch under trunk. Immediately after the first merge, land has already made **seven feature updates and one deletion push**: all six future targets and the published sibling have been published. It then pauses before the second PR on a deliberately pending required check. Saved progress is index 1, phase `prepared`.

After the controlled check becomes successful, resumption completes with **22 feature updates, seven deletions and seven total merge requests**. No first merge or first batch of updates is repeated. The published sibling is pushed once in total; the local-only sibling is never published. Both retain their own files, authors and complete messages; the independent branch keeps its original local and remote heads.

A separate real replay-conflict probe confirms the existing ordering: after one confirmed merge and trunk advance, local replay conflicts before **any client feature push, deletion push or PR edit**. The saved operation retains active Git rebase state. Deferring remote publication while keeping local replay would retain that early conflict boundary; deferring local replay would change it.

### Existing survivor-scope limit

At the end of the fanout, `ls` marks the published sibling and local-only sibling as `needs restack`; they were maintained onto trunk after the first merge and were not revisited after subsequent trunk advances. The independent `other` branch is also marked, while its refs remain unchanged as intended. Source selection uses the captured original ancestry of each current merge, not every branch now parented to trunk.

This is retained observed behavior, not repaired by the experiment. “Maintained at its affected merge” must not be presented as “every survivor rests on final trunk.” An optimization that additionally rebases all such survivors onto the final trunk changes the resulting history and scope, rather than merely postponing equivalent pushes. Keep that separate from the first bounded publication optimization.

## Candidate optimization

The smallest useful first candidate is **keep current local reparenting/replay, but delay publication of later merge targets until immediately before their own merge**. Keep non-target survivor handling eager in that first change. This preserves the current conflict timing and local continuation model while targeting the repeated remote effects.

For the measured clean seven-PR linear shape, that schedule projects six feature updates instead of 21: each of the remaining six PRs is published once before its own merge. Keeping the seven deletion pushes gives **13 instead of 28 client pushes**. That is a projection under Anthracite's current replay/publish/verify-before-merge contract, not a measured optimized result or a universal lower bound for GitHub merging. No change has been implemented here.

| Effect                                                                       | Proposed boundary                                                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Next selected PR's head push, trunk base and fresh required readiness        | Must finish before its own merge. Keep exact-head/publisher/review/policy/lease guards.                                                 |
| Head pushes and matching base/footer reconciliation for further selected PRs | Candidate for deferral until their turn, with explicit saved pending publication and fresh body readback.                               |
| Local reparenting and replay                                                 | Keep eager initially. It protects existing graph/cleanup and owned-conflict semantics; it does not save repeated local replay work.     |
| Published survivors outside the merge set                                    | Keep current handling in the first change. Final-only publication is a possible broader extension, not assumed safe by this experiment. |
| Local-only survivors                                                         | Never publish. There is no existing remote push to save.                                                                                |
| Landed-branch deletions and simulated server trunk advances                  | Not removed by this optimization. Do not bypass hooks or quietly batch away the current cleanup contract.                               |

## Safety decisions required before implementation

Deferral is not just skipping a push call. Current PR reconciliation requires the PR head to match the reached local head, and saved previews treat an unpublished reached head as awaiting mandatory publication. A supported design must distinguish deliberate deferral from interrupted required publication, retain separate reached heads and original remote leases, and report the pending work honestly.

The remote stack can temporarily show outdated diffs/checks/footers when a parent ref changes while higher heads remain old. A later PR must be refreshed before interpreting its final readiness. Its direct parent must not be deleted while leaving that PR's base unresolved; do not rely on assumed GitHub auto-retargeting. Preserve approvals and descriptions under existing rules rather than treating deferred old checks as acceptance of a new head.

A stop, cancellation or conflict must retain which merges are confirmed and which heads/base/footer updates are still owed. Explicit resumption must not repeat confirmed merges, overwrite external work or clear recovery while required publication remains. Decide legacy version-1 eager-record behavior explicitly; do not silently reinterpret existing incomplete publication as an approved new schedule.

See the separately cited [source constraints](land-push-deferral-source-analysis-2026-11-09.md) for the exact current guards and why deferring local replay is a larger change. Actual workflow starts, runner minutes, billing, hook duration and live GitHub's intermediate PR behavior are not measured here; fewer feature updates can reduce triggers but are not a quantified Actions saving.

## Retained evidence and reproduction

- [Portable public-process probe](evidence/land-push-amplification-2026-11-09/probe.cjs)
- Raw captures: [linear three](evidence/land-push-amplification-2026-11-09/linear3.json), [linear seven](evidence/land-push-amplification-2026-11-09/linear7.json), [fanout pause/resume](evidence/land-push-amplification-2026-11-09/fanout7.json), [replay conflict](evidence/land-push-amplification-2026-11-09/conflict3.json)
- [Environment](evidence/land-push-amplification-2026-11-09/environment.json), [independent validation receipt](evidence/land-push-amplification-2026-11-09/validation.json), [checksums](evidence/land-push-amplification-2026-11-09/SHA256SUMS)

Build the current source's existing CLI/test fixtures with the documented toolchain, then run the probe with Node and three arguments: absolute compiled checkout path, scenario (`linear3`, `linear7`, `fanout7`, `conflict3`), and absolute output JSON path. Leave the test-binary override unset to exercise that checkout's compiled Node CLI. Hooks and source state are confined to independently created temporary fixtures. The raw `preserved` summary flags are interpreted only for scenario participants actually present; independent validation uses the snapshots and hook transactions, not those flags alone.

Raw captures are copied byte-identically and hashed. Successful runs' final physical files are independently compared to the original target checkout; every measured client ref update/deletion is matched to a bare-remote receipt. The conflict run has no successful-final-tree claim. The probe cleans its disposable repositories after retaining records; paths inside JSON are historical capture context, not durable fixture directories.

This document records research only, not feature acceptance, an implementation specification or a live-repository recovery instruction. No optimized path was run and no live Actions cost was measured.
