# Diagnose missing sync parents before updating work

Specification for [#153](https://github.com/danielbaars/anthracite/issues/153). Scope and the public-process test boundary approved on 9 November 2026. This is a proposed change, not behavior shipped in npm 0.6.15.

## Problem Statement

After ending a halted sync, a developer can start another sync with a surviving branch whose recorded parent has disappeared. Anthracite 0.6.15 can return success while excluding that branch from refresh and replay; ordinary logs can omit it too. Its commits remain present, but the developer cannot tell that part of the stack still needs repair. Normal initialization can also prune missing-branch metadata before a later refusal.

The retained [three practical probes](../verification/sync-missing-participants-2026-11-09.md) distinguish this from two working cases: removing a leaf with no surviving dependants, and recreating a name compatibly on its current parent. All three initially encounter an independent local/remote divergence guard. The controlled retry used to isolate topology handling is experimental evidence, not a recommended force-push recovery procedure.

## Solution

Detect existing branches with tracking metadata whose recorded parent chain crosses a missing local branch. Refuse a fresh sync before metadata repair or updates, identify the unresolved branches and missing parent, and expose them in full/short log inspection. Explain that the developer must choose and restore a valid relationship before planning a new sync.

Keep the supported recovery path: inspect reached work, end an unusable saved sync with `sync --abort`, deliberately repair the relationship using existing commands, and start a new sync. Neither a missing branch nor a successful abandonment authorizes skipping saved work or inventing a new parent.

## User Stories

1. As a developer, I want sync to name a missing recorded parent, so that a successful exit cannot hide unfinished dependencies.
2. As a developer, I want indirect descendants of that missing parent included in the diagnosis, so that I can see the affected subtree.
3. As a developer, I want refusal before metadata pruning, repair or branch updates, so that my original relationships remain available for recovery.
4. As a developer, I want full and short logs to show these branches, so that I can inspect retained work without knowing hidden branch names.
5. As a developer, I want a missing-parent warning separate from valid graph edges, so that the display does not imply that my branch belongs on trunk.
6. As a developer, I want inspection to preserve checkout, staging, files and recovery, so that understanding the problem does not change it.
7. As a developer, I want clear manual repair guidance, so that I can choose the intended parent and preserve my commits.
8. As a developer, I want a new sync to work after deliberate repair, so that I can return to the normal workflow.
9. As a developer, I want ordinary untracked branches to remain harmless, so that unrelated local work does not block sync.
10. As a developer, I want an absent leaf without surviving dependants to remain supported, so that this protection does not require recreating obsolete work.
11. As a developer, I want structurally compatible name reuse to retain its current commits, so that old recovery data cannot resurrect the previous branch.
12. As a developer, I want pending-operation ownership, divergence and participant guards retained, so that diagnostics cannot authorize unsafe continuation.
13. As an agent user, I want the same diagnosis through MCP, so that automated inspection and execution respect the CLI's boundaries.

## Implementation Decisions

- **Bounded defect:** an orphan here is an existing local branch with stored tracking metadata whose recorded parent, or an intermediate recorded ancestor, names a missing local branch. Include affected indirect descendants. Do not classify an ordinary branch without tracking metadata as an orphan. Other metadata defects retain existing handling; this is not a general metadata repair engine.
- **Early preserving inspection:** fresh sync and its existing aliases inspect the original refs and metadata before normal parsing can prune missing refs or repair parent revisions. If any such orphan is found, exit nonzero before sync effects. Preserve local branch and metadata refs, physical HEAD, index, worktree contents, source pins and existing recovery/archive bytes. No checkout, staging, fetching/application, cleanup, replay or GitHub writes is needed for this local refusal. Existing pending-operation checks remain authoritative.
- **No flag bypass:** force, deletion consent, no-delete, no-pull and no-restack do not authorize ignoring a missing relationship. Disabled GitHub integration does not disable this local graph check. Report affected branch names and the missing ancestor relationship, explain that no sync updates were applied, and distinguish unresolved work from completed work.
- **Visible inspection:** full and short log routes and their aliases expose metadata-bearing orphan branches by default in a clearly separate diagnostic section or equivalent visibly disconnected representation. Identify the missing parent and affected branches without drawing a synthetic trunk/parent edge. Retain ordinary valid-graph ordering, depth/selection behavior and zero-depth branch selection. A repository-level diagnostic may accompany a bounded view; it must not pretend that excluded branches are selected graph rows. Do not turn ordinary untracked branches into default graph entries. Inspection is preserving in both normal and pending-sync contexts and reports the physical checkout accurately, including detached HEAD.
- **Explicit repair:** guidance starts with inspection and, when necessary, the supported abandonment command. It explains that restoring the original parent or deliberately selecting a valid parent with existing tracking/history commands is a separate decision. Tracking requires a valid ancestor relationship; do not suggest that merely naming the currently rewritten child necessarily repairs old history. No implicit rebase, branch resurrection, parent choice or obsolete-commit removal is authorized. Once repaired, start a fresh plan; real conflicts use existing continuation.
- **Keep working boundaries:** no surviving orphan means the missing-leaf case can proceed under existing guards. A name recreated compatibly on the current parent can retain its new head and the existing permissible parent-revision repair. This does not approve arbitrary name reuse on an unrelated base. Local/remote divergence still requires its own decision; the probe's synthetic remote alignment is not product behavior.
- **Recovery compatibility:** leave saved continuation ownership, source/participant checks and preserving abandonment intact. Missing participants are never counted as completed replay. Inspection and fresh refusal must not mutate old saved records or abandoned evidence. No stored-format migration or new recovery authority is introduced.
- Update sync/log guidance and existing MCP learning where needed to describe the diagnosis and deliberate repair path. Keep the change within one implementation PR.

## Testing Decisions

Use one primary seam: public Anthracite CLI processes against real temporary Git repositories and bare remotes, controlling only GitHub responses at the existing `gh` boundary. Reuse existing sync/recovery, abandonment and log process fixtures. Assert external output/status and independently read actual refs, raw metadata, HEAD, index entries, file bytes and recovery evidence; do not test private plan objects or introduce internal test interfaces.

| Group | Required external behavior |
| --- | --- |
| Original three cases | Reproduce missing leaf, missing parent with a surviving child, and compatible recreated name. Keep the independent divergence refusal distinguishable from the orphan refusal; deliberately align only fixture remotes when isolating topology behavior. |
| Missing chain | Direct and intermediate missing ancestors identify all affected existing metadata-bearing descendants. An independent valid arm remains unchanged. An ordinary untracked branch alone does not block. |
| Early refusal | Nonzero sync before metadata pruning/repair or updates, including relevant force/cleanup/restack options and disabled integration. Snapshot raw state before invocation, not after engine initialization; retain missing-parent metadata as well as surviving work. |
| Preserving display | Full/short routes and aliases show the orphan diagnosis without invented edges or duplicate valid rows. Cover default and bounded/zero-depth views, `--show-untracked`, pending sync and a physically detached checkout. Verify byte-preserved recovery and local work. |
| Existing protections | Retain owned-active, raw-aborted and foreign-rebase refusals, changed-participant protection before continue-all staging, divergence, frozen and occupied-worktree guards. Include dirty/staged work in preserving refusal/inspection. Do not reinterpret a no-active-rebase refusal as proof of participant validation. |
| Explicit recovery | Inspect and abandon a halted sync, deliberately restore a valid relationship with existing commands, then complete a fresh sync while retaining branch-specific commits/content/authors/messages. If replay conflicts, resolve through normal continuation. No automatic parent choice or remote publication. |
| Delivery | Run focused Node/native acceptance, core refusal/inspection/repaired-sync cases through an isolated installed npm candidate, and one existing MCP-client smoke proving the same diagnosis and preservation. |

Reuse existing public log/recovery controls rather than building a full new matrix. Record measured results separately from this specification. Specification delivery performs document/evidence/link checks only; the proposed runtime acceptance belongs to implementation.

## Out of Scope

Automatic skipping or resumption after participant disappearance; a new repair command; automatic reparenting, resurrection, rollback or history rewriting; general corrupt-metadata repair; arbitrary same-name recreation identity redesign; archive pruning or new retention guarantees; changes to cleanup, overwrite/reset authority or PR discovery; classic/long log redesign; multi-trunk expansion; live GitHub fixture writes; user-project or installation changes; release/publication of a CLI version.

No CI runs are required for this specification. The full CI matrix remains off throughout this work; later implementation may use ordinary CI only within the agreed budget.

## Further Notes

This specification narrows #153's original open design question: the approved next step is honest visibility, early refusal and deliberate repair, not a missing-participant continuation engine. #152 already delivered preserving abandonment in npm 0.6.15; it remains the safe exit, not a rollback or topology repair.

Evidence is version-bound to public npm 0.6.15 and its published source. The missing/recreated branches in the probes were local-only, the live rebase had already been raw-aborted, and the compatible replacement was created on its current parent. No successful live skipping, unrelated-base reuse or permanent object-retention guarantee was demonstrated. The evidence report and raw records remain unchanged.
