# Preserve and explain unpublished local work during sync

Scope and the public-process test boundary approved on 11 November 2026. This specifies a proposed change, not behavior already shipped in npm 0.7.0 or acceptance of an implementation.

## Problem Statement

A successful sync can create the apparent divergence that causes the next sync to ask whether to overwrite or rebase the local branch. For example, sync advances main and restacks an audit branch and its child locally, without publishing them. A second sync sees different commit IDs, offers reconciliation and does not explain that the branch changes may still match remote on a newer local base.

The generic same-parent menu also appears for ordinary unpublished local commits. Developers cannot readily distinguish their own pending publication from incoming changes, and the options make replacing the newer local history appear to be a normal refresh step.

The [retained npm 0.7.0 investigation](../verification/sync-local-restack-research-2026-11-11.md) reproduces this through public CLI processes. It also demonstrates that equal patch IDs or equal aggregate branch diffs can hide changed messages, whitespace or commit order.

## Solution

Sync should explain which kind of difference it has verified. When remote is already contained in the local branch under the same parent contract, keep the local commits. When conservative comparison establishes equivalent branch-owned commits on a newer local base, keep that unpublished restack, including a child whose parent was itself verified as restacked.

Continue normal sync work for the remaining selected graph and any required local maintenance. Report that local history differs from its published head and that submission is a separate action. Do not push automatically or require a rebase/overwrite choice for these proven preservation cases.

When histories genuinely differ or evidence is insufficient, retain deliberate reconciliation and explain the observed local/remote difference without claiming that another person changed remote. Default output uses branch names, concise status cues and a useful next action; debug retains commit IDs and proof/refusal details.

## User Stories

1. As a developer, I want two consecutive syncs to preserve the restack created by the first, so that normal refresh does not ask me to undo its own local work.
2. As a developer, I want ordinary local commits retained when they contain the verified remote head, so that unpublished work is not mistaken for an incoming replacement.
3. As a developer, I want the same-parent contract verified before automatic preservation, so that a PR retarget does not silently change my stack relationships.
4. As a developer, I want a restacked parent and child recognized together, so that the child does not trigger the same confusing menu immediately afterward.
5. As a developer, I want current GitHub and Git remote identities checked, so that a stale PR association or changed source cannot authorize preservation of the wrong work.
6. As a developer, I want retained branches clearly marked as awaiting publication, so that successful sync is not mistaken for local/remote equality.
7. As a developer, I want publication to remain separate from sync, so that refresh never force-pushes my work without submission authorization.
8. As a developer, I want unrelated eligible incoming changes processed normally, so that keeping one unpublished branch does not disable repository-wide refresh.
9. As a developer, I want mandatory descendant maintenance retained, so that preserved work does not leave a newly updated parent or surviving child inconsistent.
10. As a developer, I want complete commit messages and authorship preserved, so that matching code alone cannot erase my local explanation or attribution.
11. As a developer, I want commit order and empty commits considered, so that an equal final diff is not mistaken for equivalent history.
12. As a developer, I want whitespace, binary and file-mode changes treated as real data, so that a lossy comparison cannot discard work.
13. As a developer, I want a real incoming change after my restack to require reconciliation, so that recognition does not ignore concurrent remote work.
14. As a developer, I want uncertain or unsupported comparisons to remain guarded, so that convenience does not depend on guessing which side changed.
15. As a developer, I want concise explanations in a terminal and noninteractive output, so that I can choose a next action without reading raw object IDs.
16. As a developer, I want declining reconciliation to preserve refs, staging, files and existing recovery, so that inspecting a difference does not apply a plan.
17. As a developer, I want frozen branches, occupied worktrees and local files to retain their protections, so that keeping one head grants no new rewrite authority.
18. As a developer, I want existing sync options to retain their meaning, so that keeping local work does not authorize cleanup, trunk reset or publication.
19. As a developer, I want interrupted operations to retain their selected sources and choices, so that continuation does not reinterpret an older overwrite/rebase plan.
20. As a developer, I want existing released recovery records to remain usable, so that upgrading does not require editing private state.
21. As an agent user, I want MCP to expose the same classification and command result, so that automation can identify pending publication without bypassing the CLI.
22. As a developer, I want help and documentation to distinguish local restack readiness from published PR state, so that a clean local log does not imply that GitHub has the same history.

## Implementation Decisions

- **Sync-only scope:** apply preservation to existing eligible tracked open-PR branches under the configured trunk. Keep repository-wide selection and the existing independently guarded merged-parent survivor repair. Get retains its current selection, overwrite and reconciliation behavior even where implementation helpers are shared. No new CLI option or persistent user preference is required.
- **Fresh source contract:** use the existing verified repository/PR identity, captured remote head and explicit local/remote parent snapshots. Validate the local head, parent metadata and fetched source against those observations before relying on a classification and before effects. A same branch name or cached PR state is insufficient. Parent changes retain existing guarded reconciliation; branch reuse, terminal PRs and missing parents retain their separate protections.
- **Local-ahead preservation:** when the fresh remote head is an ancestor of the local head and the tracked parent relationship matches the verified remote parent, preserve the local head as the incoming-refresh decision. Equality remains an ordinary up-to-date case. Do not reset, rebase onto the older remote head or claim that the local-only commits have been published. Necessary subsequent maintenance remains separate.
- **Conservative restack evidence:** require a validated pairing of remote and local parent bases and a nonempty, ordered comparison of branch-owned commits above those bases. Establish the newer root-base relationship through verified ancestry. For a child of a rewritten parent, use an already verified remote/local parent-head pairing; direct ancestry between those rewritten heads is neither required nor sufficient. Do not infer the pairing from names alone or let proof of one branch cover an independent arm.
- **Compare what belongs to the branch:** compare each commit's exact changes, authorship including author identity/time, and complete message in order. Retain whitespace, binary/mode/path changes and empty-commit/message distinctions. Commit IDs and committer timestamps can legitimately change during replay; this allowance must not erase author-owned data. Patch-ID equality, aggregate diff/tree equality, approximate range matching, cached state or reflog prose alone cannot establish equivalence. A retained prototype demonstrates the bounded comparison, not a production-complete proof algorithm.
- **Bounded recognition rather than universal rebase detection:** unsupported merge/commit shapes, missing objects or parent evidence, contextual differences that cannot be established conservatively, amended/reordered commits and contradictory observations fall back to explicit reconciliation. Bound graph/commit traversal to captured sources; exhausted limits remain uncertain. A false negative is acceptable with honest explanation; a false claim of equivalence is not. Additional local commits after an already rewritten restack are not automatically covered by the simple local-ahead rule or by a shorter matching prefix.
- **Preservation is not a blanket skip:** do not apply the older remote head to a preserved branch. Retain its current local replay boundary, frozen status, PR association and own work. Keep fresh PR status handling and ordinary cleanup eligibility checks. Other eligible sources still refresh, and changed parents/mandatory descendants still undergo their already authorized local maintenance. Retaining a branch is not permission to delete it, import remote-only branches or broaden replay.
- **Output contract:** distinguish up to date, incoming fast-forward, unpublished local commits, conservatively equivalent local restack and different/uncertain history. Explain that commit IDs can differ while branch-owned commits match. Preserved cases identify the branch and pending publication without calling it fully synchronized with GitHub. Use concise status cues and a submit-preview next action appropriate to the disclosed affected chain; do not instruct a broad all-stack push or imply approval for one. Unknown cases describe observations and available choices, retain an abort path and never attribute a remote edit to another person without evidence. No new machine-output API is introduced.
- **Authority and options:** sync continues to make no pushes, PR edits or merge requests. Preserve no-pull, no-delete, delete-all, force and no-restack contracts. Force is not feature-overwrite authority. Default local maintenance may legitimately move a preserved head; no-restack retains its existing limits. Keep frozen/worktree/dirty-file/collision guards and source/metadata concurrency checks before their relevant effects. Read failures or raced identities refuse before unchecked application.
- **Continuation and compatibility:** record enough bounded plan information for a later process to preserve the selected local work and original source/parent obligations. Revalidate ownership, local participants and any required saved cleanup PR evidence before staging or advancing. Do not select newer sources, consume another operation, or reinterpret an already saved explicit rebase/overwrite decision as preservation. Existing published sync/get recovery contracts remain supported without mandatory branch-metadata migration or hand-edited records. Interrupted work, abort and source-pin release retain their existing preserving boundaries; document downgrade limits for any new optional recovery decision.
- Update the sync guide, applicable command guidance and existing MCP learning in English. Keep implementation within one focused PR; the specification creates no implementation tickets or PR itself.

## Testing Decisions

Use one existing primary seam: public CLI processes with real temporary Git repositories and bare remotes, controlling only GitHub answers at the gh boundary. Reuse existing refresh/authority, merged-parent, cleanup identity, conflict/recovery and preserving-inspection fixtures. Include PTY and noninteractive routes at this same seam; one existing MCP client smoke covers delivery. Do not introduce an internal classifier test interface.

Assert actual refs/trees, commit authors/messages/order, index/files, parent metadata, source pins, recovery and remote receipts. Verify the exact branches kept, refreshed and maintained. Compare abort snapshots and independent remote heads; success text alone is insufficient. Scope observations to the operation, allowing existing documented fetch/cache planning effects rather than calling sync globally write-free.

| Group | Required acceptance |
| --- | --- |
| Consecutive syncs | Advance trunk, run real sync to restack a published branch, then run sync again without submit. The second preserves the local history without the old rebase/overwrite menu and reports pending publication. Repeat for a parent-child stack; neither branch falls back merely because its parent has a different commit ID. |
| Ordinary local commits | Same-parent remote-contained local commits survive interactive and unattended sync without overwrite/rebase choice; complete messages/authors and unpublished status remain intact. Equality and incoming fast-forward controls keep their normal behavior. |
| Proof boundaries | Reject false equivalence for changed content, author, full message, whitespace, order, binary/mode changes and an extra empty commit. Cover matching patch IDs with different bytes/messages and matching aggregate diffs with different history. Unsupported or insufficient proof remains guarded; do not silently drop commits or metadata. |
| Fresh incoming work | Add or rewrite remote work after local restacking and race source/PR/parent observations. No partial/equivalent-looking prefix authorizes ignoring the new source. Known mismatch or unavailable identity follows the existing preserving refusal/reconciliation contract. |
| Graph integration | Keep an eligible restacked arm while refreshing a separate safe arm; preserve independent refs. Exercise necessary descendant maintenance, same-parent checks and the existing merged-parent/local-commit repair. No import, cleanup or publication scope expands. |
| Options and protection | Preserve no-pull/no-delete/delete-all/force/no-restack meaning, integration opt-out, frozen and occupied participants, tracked dirt and file collisions. Verify that choosing to keep a head cannot bypass a later mandatory replay guard. |
| Abort and uncertainty | Declining a genuine/unknown difference preserves reached refs, physical checkout, index/files and recovery. Noninteractive uncertainty refuses rather than selecting overwrite/rebase. Output identifies the actual state without claiming someone changed remote or that publication happened. |
| Recovery | Trigger genuine required replay conflict after a preserved decision, resolve/stage and continue in a fresh process. Preserve local commits and selected sources, cleanup evidence and checkout intent. Interrupt before/after reached maintenance; safely retain partial work and owned state. Exercise a real published 0.7.0 recovery record and existing abandonment, without editing records or changing its saved choices. |
| Delivery and non-regression | Run focused Node/native cases and core scenarios against an isolated installed npm candidate, plus one existing MCP smoke. Check that get behavior remains unchanged. Verify no live GitHub writes and no user-installation changes. |

The retained investigation ran nine public npm 0.7.0 comparison cases, five strict diagnostic cases, two raw-byte diagnostic cases and one parent-child probe. Some scenarios repeat across campaigns; these are not 17 distinct acceptance cases. It confirms the baseline problem and constrains the proposed recognition, but does not establish candidate/native/MCP acceptance or every protection above.

## Out of Scope

Automatic submission or force-push; PR creation/edits/roles; changes to get semantics; Graphite comparison; universal detection of arbitrary rebases, squashes, conflict resolutions or reordered/amended histories; silently keeping ambiguous incoming changes; treating branch names or reflogs as authority; new user toggles or persistent preferences; general metadata/recovery redesign; missing-parent recovery from #153; submit-restack work from #90; changes to cleanup/reset authority or repository workflows; live GitHub fixture changes; user-project or active-installation changes; CLI release publication.

No CI runs during specification. The full CI matrix remains off. Later implementation may use ordinary inexpensive CI, but this specification starts no workflow.

## Further Notes

The baseline is public npm 0.7.0, source `4fc0fa51a3f374c4346842d27aa0daee82baf3dc`. Its examined branch metadata records the parent name/revision and PR information but no dedicated last-published head. This specification does not invent that missing provenance or require persistent publication bookkeeping for the bounded comparison. Record any implementation-specific extension and compatibility obligations explicitly before relying on it.

The [research record](../verification/sync-local-restack-research-2026-11-11.md) retains the original baseline observations, exact files and limitations. A [separate specification record](../verification/sync-local-restack-spec-2026-11-11.md) identifies the approved boundary and checks. The strict prototype can conservatively reject a valid contextual replay; such uncertainty must remain visible. Recognition establishes a relationship between currently verified histories, not who performed a historical rewrite.
