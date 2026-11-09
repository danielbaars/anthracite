# Safely abandon and inspect a halted sync

## Problem Statement

A halted sync can require abandoning an obsolete branch instead of resolving its rebase. Public npm 0.6.14 has no supported sync-abandonment command. A raw Git rebase abort removes the active rebase needed by `continue`, while the saved sync still blocks `ls`, `log`, deletion and another sync. Users must interpret and remove private recovery data themselves.

The preserving refusal is intentional, but the missing exit is a workflow defect. Inspection is inconsistently available: explicit branch `info`, `children` and `pr` worked in the retained probe, while `ls` and `log` refused. Missing-participant continuation is separated into [#153](https://github.com/danielbaars/anthracite/issues/153).

## Solution

Add `an sync --abort` to end only the owned sync, retain recovery evidence and disclose reached and unfinished work. A matching active owned rebase is quit while retaining physical HEAD, index and worktree contents. Already completed updates, deletions and rewrites stay applied. An already aborted rebase or missing participant does not prevent abandonment.

Permit preserving log inspection during a pending sync. Explain that ending the sync does not resolve remaining index conflicts, restore a checkout or make dirty files safe to discard. Normal Git/file guards still apply to subsequent work. No automatic branch deletion or rollback is added.

## User Stories

1. As a developer, I want one command to abandon an owned sync, so that obsolete work does not trap my repository.
2. As a developer, I want abandonment after a raw Git abort, so that a missing live rebase does not remove my exit.
3. As a developer, I want an externally removed participant reported, so that I can end the sync without silently advancing its queue.
4. As a developer, I want completed trunk, feature, cleanup and maintenance effects listed, so that I know what remains applied.
5. As a developer, I want pending and uncertain work distinguished, so that a saved completion flag is not mistaken for fresh verification.
6. As a developer, I want conflict resolutions and local files preserved, so that ending a workflow does not discard work.
7. As a developer, I want a readable recovery archive reference, so that later investigation does not require reconstructing deleted evidence.
8. As a developer, I want log inspection while sync is pending, so that the recovery guidance is usable.
9. As a developer, I want physical checkout and pending intent labelled separately, so that a detached HEAD is not shown as a checked-out branch.
10. As a developer, I want existing inspection routes to remain preserving, so that investigating cannot consume recovery.
11. As a developer, I want clear guidance for an obsolete local-only branch, so that I can abandon, deliberately handle remaining Git state and then consider deletion.
12. As an agent, I want noninteractive abandonment and explicit outcomes, so that recovery does not depend on editing private files.
13. As a maintainer, I want original-worktree and ownership checks, so that one workflow cannot quit another rebase or remove foreign recovery.
14. As a maintainer, I want frozen status, changed refs and occupied worktrees preserved, so that abandonment grants no rewrite authority.
15. As a developer, I want repeatable handling of absent or partially released recovery, so that interrupted abandonment has a safe next action.
16. As a maintainer, I want published version-1 sync records supported, so that upgrading provides an exit for existing halted operations.

## Implementation Decisions

1. **Command and authority.** Add `--abort` to sync routes/aliases, including `repo sync`, with noninteractive support and no GitHub/network dependency. Explicit refresh, cleanup, reset, force or restack options combined with it refuse before effects; ordinary defaults do not run. No push, merge or PR edit occurs. Successful abandonment and an already-absent operation return distinct successful outcomes; failures return nonzero.
2. **Ownership differs from continuation eligibility.** Validate supported schema/digest and original repository, trunk, remote and worktree identity. An absent rebase, removed branch or changed participant may be reported without authorizing replay or overwrite. Malformed/unsupported or mixed recovery, wrong worktree, foreign active Git state and concurrent recovery replacement refuse preserving everything. Missing pins remain unavailable evidence, never recreated or counted as completion.
3. **Preserving release.** Durably retain original recovery bytes and source-pin observations before release, in repository-local private storage. Quit only a matching owned rebase. Preserve physical HEAD, branch refs/metadata, frozen flags, index and tracked/untracked files; retain any owned autostash without applying/discarding it. Remove only the active owned sync recovery after successful release, keeping archive/source pins and printing their reference. No checkout, staging, reset, replay, global cleanup or mandatory version-1 migration.
4. **Failure and retry.** Report partial effects if Git quit or recovery release fails; preserve evidence and competing state. Completion requires the blocking owned state to be released. Retry may reuse matching archives without overwriting them. An absent sync must not clear another workflow or quit raw Git. Subsequent commands retain normal dirty/frozen/worktree guards; abandonment does not resolve conflicts or restore checkout.
5. **Report.** Distinguish recorded completed effects, current local observations, pending/unattempted work, remaining maintenance and unavailable/conflicting evidence. Inspect refs/parents without repair; saved completion is not fresh verification or GitHub readiness. Include checkout/conflict status, archive reference and next steps. Missing participants are not completed work. Do not prescribe blanket recovery-file deletion.
6. **Inspection.** Use the preserving inspection lifecycle for full/short logs and aliases during supported pending sync. Preserve recovery bytes, pins, refs/metadata, index and files; retain existing `info`/`children`/`pr` behavior. Physical attached HEAD determines current branch. At detached HEAD, a validated pending participant may anchor selection only, labelled pending rather than checked out; fall back to trunk if unavailable. Explicit zero-depth retains its detached-HEAD refusal. Preserve ordinary selectors, classic/long semantics and existing presentation. Invalid recovery is never repaired or consumed.
7. **Guidance and delivery.** Explain that raw Git abort removes the rebase required by continuation but leaves previous sync effects. Offer `sync --abort`. For a confirmed no-PR participant, suggest abandonment, deliberate handling of residual Git/files, then consideration of guarded deletion/new sync. Unknown PR status must not mean no PR. Update help, completion, sync documentation and existing MCP learning in one implementation PR. Release/installation require a later request.

## Testing Decisions

Use **one existing seam: public Anthracite CLI processes** with real temporary Git repositories, bare remotes and real conflicts. Control GitHub only through existing external `gh` fixtures; do not mock the engine, expose recovery internals or build a new testing interface. Assert output/status and externally observable refs, checkout, metadata, index, files, archive and recovery preservation rather than private helper calls.

Extend the existing owned-sync recovery, cleanup-identity recovery, preserving log-state/depth, cwd/worktree and installed Git/MCP acceptance patterns. Keep six scenario groups rather than a Cartesian matrix:

1. Full/short inspection and aliases during conflict and after raw abort; attached/detached checkout, zero-depth refusal and existing inspection routes remain accurate and preserving.
2. Abandon a matching active sync rebase and a published-record sync whose Git rebase is already gone, including a removed participant; never replay the remainder.
3. Preserve confirmed updates/cleanup/maintenance, user refs and frozen state, staged/unstaged/untracked work and manual resolutions; retain an existing autostash and source pins where applicable, and disclose residual conflicts/maintenance.
4. Refuse foreign/mixed/malformed recovery, wrong worktree, foreign Git operations and concurrent recovery replacement; participant changes cannot become replay authority or overwrite permission.
5. Exercise interrupted release, matching archive reuse, no pending sync and another workflow's recovery; subsequent commands lose only the owned sync gate and retain ordinary dirty/frozen/worktree safeguards. Normal `continue` still works when it remains eligible.
6. Produce a real saved record through public npm 0.6.14, then exercise the candidate; run focused Node/native checks and core installed npm cases. One real existing MCP-client smoke inspects and abandons synthetic pending sync through current tools. Cover help/completion and conflicting option refusal without real GitHub writes.

## Out of Scope

Missing-participant skipping or continuation without an active owned rebase ([#153](https://github.com/danielbaars/anthracite/issues/153)); automatic rollback or conflict resolution; branch deletion; trunk reset/feature overwrite; general get/absorb/landing cancellation; corruption repair; archive/source-pin pruning; multi-trunk redesign; live GitHub test PRs; user-project/installation changes; CI runs during specification; full CI matrix execution.

## Further Notes

Scope and the single public-process test seam were approved on 2026-11-09. This specification replaces the broader original proposal in [#152](https://github.com/danielbaars/anthracite/issues/152); the unchanged original report is retained with the evidence. The following tests are implementation acceptance, not claims of implemented behavior. See [baseline observations and reproduction](../verification/sync-abandonment-2026-11-09.md). Full CI remains off unless separately authorized.
