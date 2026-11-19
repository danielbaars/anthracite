# Inspect landing replays before the first merge

Scope and the public-process test boundary approved on 19 November 2026 for [#204](https://github.com/danielbaars/anthracite/issues/204). This is a proposed change, not shipped behavior or implementation acceptance.

## Problem Statement

A new landing can merge its bottom PR before discovering that a later branch conflicts with work already on remote trunk. The user then resolves a predictable conflict in a partially landed stack. A stale local trunk makes this especially surprising: the plan notices that trunk needs advancing but does not try the future replay.

The retained [0.9.2 reproduction](../verification/land-replay-preflight-spec-2026-11-19.md) confirms a successful preview, one merged PR and a conflict in the next branch after an independent remote-trunk change. The separate pending-publication reporting problem was fixed in 0.9.3 under #205; that correction adds no pre-merge replay inspection.

## Solution

Before a new landing's first merge, simulate the complete planned sequence of local history transformations against the inspected remote trunk in disposable storage. Include every merge target and every mandatory surviving branch, retaining their actual replay boundaries and dependency order.

If a replay conflicts, refuse before starting the landing. Identify the branch and conflicting paths, explain which later work remains unverified, and advise explicitly updating the affected stack, resolving conflicts and submitting changed work before previewing again. Do not automatically sync, restack or publish.

Both dry-run and ordinary application show the same replay assessment. A clean assessment means the captured local replay is possible, not that all future PRs have passed readiness or that remote cannot change later. Existing per-effect safeguards and recovery remain necessary.

## User Stories

1. As a developer, I want known replay conflicts detected before the first merge, so that I can resolve them before any PR lands.
2. As a developer, I want current remote trunk inspected even when local trunk is stale, so that an unfetched independent merge is included.
3. As a developer, I want every selected target checked in landing order, so that a clean bottom PR cannot hide a later conflict.
4. As a developer, I want mandatory published and local-only survivors checked, so that side-branch conflicts do not surprise me after a merge.
5. As a developer, I want independent branches excluded, so that unrelated work neither blocks nor expands my landing.
6. As a developer, I want commits replayed with their real boundaries and order, so that an intermediate conflict cannot hide behind a clean final diff.
7. As a developer, I want the conflicting branch and literal paths reported, so that I know what to resolve.
8. As a developer, I want untested dependent work distinguished from clean work, so that partial inspection cannot imply complete success.
9. As a developer, I want preview to preserve checkout, staging, files and metadata, so that inspecting does not disturb my work.
10. As a developer, I want simulation to run no project hooks or commands, so that inspection cannot execute application side effects.
11. As a developer, I want missing evidence or interrupted inspection to refuse safely, so that uncertainty cannot authorize a merge.
12. As a developer, I want the confirmed plan bound to the inspected inputs, so that stale simulation cannot authorize changed work.
13. As a developer, I want required checks and approvals retained after a clean replay assessment, so that local compatibility cannot replace GitHub protection.
14. As a developer, I want deferred pushes and unpublished survivors preserved, so that inspection cannot expand publication.
15. As a developer, I want my existing pending landing to retain its recovery path, so that an update does not reinterpret reached effects.
16. As a developer, I want actionable manual recovery advice, so that I can update the intended stack without an automatic repository-wide sync.
17. As an agent user, I want the same preserving refusal through existing MCP execution, so that automation cannot bypass the CLI boundary.
18. As a maintainer, I want bounded, disposable simulation, so that failures leave neither a partial landing nor unrelated temporary data removal.

## Implementation Decisions

- **New-landings boundary:** inspection belongs to fresh landing planning and validation before the first merge request. Apply it whether local trunk is current or behind. Supported saved landings retain their existing execution, inspection and recovery behavior; do not retrofit this requirement onto reached work.
- **Exact graph scope:** consume the existing plan's target chain, captured own-commit ranges, parent relationships, verified cleanup-only results and mandatory survivor graph. Simulate the actual evolving trunk, reparenting and replay order, including repeated maintenance when required by current semantics. Exclude independent stacks and do not discover new participants.
- **Commit-level fidelity:** predict the existing rebase-only workflow using equivalent Git replay semantics, including intermediate commits, dependency trees, empty/already-applied changes and actual merge/replay boundaries. A final-tree merge alone is insufficient. Simulated commit IDs are not predicted GitHub merge IDs and must never become execution leases or confirmed merge results.
- **Isolated effects:** inspect immutable captured objects in disposable repositories outside the user's Git/worktree administration. Fetch missing objects only there. Do not change source refs, object storage, checkout, index, working/ignored files, metadata/cache, recovery, configuration or remote state. Do not register a worktree in the source project.
- **Execution isolation:** run no project hooks, editors, package scripts, custom executable merge drivers, filters or other project commands. Preserve supported replay-relevant semantics safely; when unsupported configuration prevents faithful isolated simulation, report the limitation and refuse rather than silently ignoring it or executing project code. Retain ordinary Git transport authentication without recording credentials.
- **Assessment:** distinguish clean replay, concrete conflict and unavailable/unsupported inspection. Conflict and unavailable results return nonzero before landing-owned recovery or effects start. Report the first reproducible blocking branch and its conflicting paths safely, including unusual filenames; do not promise exhaustive downstream conflicts once a prerequisite is unresolved. Never label skipped dependent work clean.
- **Presentation:** disclose replay feasibility separately from next-PR readiness. Fresh dry-run and the pre-confirmation report use the same assessment. A successful result does not authorize later merges, waive publication or replace fresh policy, checks, reviews, identities, leases, worktree/frozen protection or local-state guards.
- **Freshness:** bind the assessment to the captured trunk, participant heads, parents, replay boundaries, relevant local/configuration state and inspected scope. Revalidate after confirmation and under the existing pre-effect protection. Changed relevant inputs invalidate the prior assessment and refuse before the first merge; a fresh invocation can inspect and request confirmation again. Avoid volatile simulated timestamps/IDs in plan equality. Reuse within one invocation is permitted only when all relevant inputs still match.
- **Bounded failure:** bound subprocess and aggregate simulation work; propagate cancellation, timeout, fetch/object failures and unsupported history as unavailable evidence. Terminate owned simulation processes, preserve foreign processes and remove only owned temporary resources. Do not leave a source lock or pending landing merely because simulation failed or was declined.
- **Existing authority:** preserve version-2 deferred publication, mandatory survivor maintenance, local-only status, cleanup consent, branch/PR identities and all per-merge checks. No schema migration or new CLI option is required. Remote may change after final inspection or after a merge; existing refusal and conflict-continuation behavior remains authoritative, including the #205 correction.
- **Guidance and delivery:** explain the blocked branch and a deliberate refresh/restack/resolve/submit/re-preview sequence appropriate to the inspected stack. Do not imply that fetch alone advances local trunk or that generic restack necessarily selects only this landing. Update CLI/MCP learning through their existing routes. Keep implementation in one PR.

## Testing Decisions

Use one existing seam: public CLI processes with real temporary Git repositories and bare remotes; control only GitHub responses at the established `gh` boundary. Observe actual local/remote state and outbound GitHub effects. Do not expose or test private simulator interfaces, mock internal Git logic, or assert an exact internal command sequence.

Prior art includes preserving landing-object inspection, public chain/fanout planning and delivery, confirmation races, deferred push observation, conflict continuation and the existing installed MCP client. Assertions should remain valid when simulator internals change.

| Scenario                     | Required observation                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reported failure             | Independent trunk work conflicts with a later target while local trunk is stale. Preview and ordinary application refuse before any merge, push, PR edit, cleanup or landing recovery; identify the branch and paths.                                                                                                     |
| Replay coverage              | Cover later targets, multi-commit intermediate conflicts, mandatory published/local-only side branches and deeper descendants. Exclude independent branches. Stop calling downstream work verified after a prerequisite conflict.                                                                                         |
| Clean behavior               | Current and advanced trunk, clean multi-commit replay, already-applied changes and supported cleanup-only members permit the normal plan. Actual execution retains final content, deferred push scope, local-only survivors and landed-only cleanup.                                                                      |
| Preservation                 | Compare project refs, objects, HEAD, index, staged/unstaged/ignored/untracked files, metadata/cache, configuration and recovery. Inspect remote refs and controlled PR calls independently. Hooks, filters and custom command sentinels never execute during simulation. Declining confirmation preserves the same state. |
| Incomplete evidence          | Missing local remote objects can be obtained only in disposable storage. Fetch failure, unsupported replay/configuration, inaccessible history, timeout and cancellation refuse without a clean claim or partial landing; clean owned temporary resources without deleting foreign sentinels.                             |
| Freshness                    | Mutate remote trunk, relevant participant heads/parents/replay inputs or configuration between preview, confirmation and first effect. No request may use stale successful evidence. Changes after an earlier confirmed merge retain ordinary guarded recovery.                                                           |
| Protection and compatibility | Dirty/frozen/occupied participants, identity/lease changes, missing approval and failed/unavailable required checks remain protected. Optional checks keep current semantics. Existing saved landing schedules, conflict continuation and #205 pending-maintenance preview/resumption remain unchanged.                   |
| Delivery                     | Run focused Node/native checks, core isolated installed-npm scenarios and one existing MCP-client smoke proving the same preserving refusal. No new MCP tool.                                                                                                                                                             |

These are implementation acceptance requirements, not completed tests. During specification, perform document, link, evidence-integrity and scope checks only. No new live GitHub fixtures, user-project/installation changes or CI runs. The full CI matrix remains off.

## Out of Scope

Automatic sync/restack/submission, changes to PR merge methods or protection, new force/bypass options, new participant discovery, speculative checks of unrelated branches, exhaustive conflict discovery behind failed prerequisites, guarantees against future remote changes, elimination of normal GitHub checks, push optimization, retroactive simulation of saved landings, recovery-format migration, #205 reimplementation, automatic conflict resolution and release/installation changes.

## Further Notes

The [verification record](../verification/land-replay-preflight-spec-2026-11-19.md) preserves the original issue and synthetic 0.9.2 observation. The implementation must turn that reproduction into a regression that refuses before the first request. Retain the historical report rather than describing the proposed behavior as already delivered. Publication of this specification does not authorize implementation, an implementation PR, or npm publication.
