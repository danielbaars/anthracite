# File-split specification research — 28 October 2026

## Purpose and evidence boundary

This report supports the [file-split specification](../specs/split-by-file.md) within the owner's six approved groups: correct splitting/history; selection/file kinds; naming/identity/selection limits; early local/frozen/worktree guards; descendant replay/recovery; public CLI/legacy/MCP behavior. It is research, not implementation acceptance.

The [earlier demonstration](split-by-file-demo-2026-10-28.md) remains unchanged, including its incomplete dirty-capture cleanup result. This round adds **nine complete native process observations** and independent Git states. The [validator](../verification/evidence/split-by-file-spec-2026-10-28/validation.json) reconciles 92 named outcome predicates, not 92 scenarios or features. Its evidenceIds map each case to the retained REA record. The [manifest](../verification/evidence/split-by-file-spec-2026-10-28/manifest.json) certifies the retained files.

Graphite is pinned at 1.8.6, executable SHA-256 `9153b4b6d9ad8084ec700a1fb80dd8a4b35c08c3116bf41f1fcdd792b326781f`. Installed Anthracite is `0.1.1-dev.20261027211215`, SHA-256 `3042f6c7dfee0f4c4a26ed9056a6405dc6e00dd844488d04dfe883f91bd580d9`, from product source `3923b1088b29f02ce9d9e2d8da9fb52339889915`. Documentation commits do not implement file mode.

Separate synthetic repositories use isolated HOME/config/auth directories, no remote, fixed fixture timestamps and refusing gh/editor/pager sentinels. REA 6.7.0 observes Graphite under a bounded PTY with --no-interactive and no input events. Git independently records refs, parents, trees, bytes, messages and staging.

## Newly measured Graphite behavior

| Probe | Observed outcome |
| --- | --- |
| multi | Three source commits flatten into one selected and one remainder commit. Both messages join all original messages oldest first with blank lines. Generated author/committer use invoking Git identity, replacing distinct original authors. Source and synchronized child tip trees remain identical. |
| all | Complete selection creates feature_split, **deletes feature**, switches checkout to feature_split, and reparents the child without changing its commit. The original source tree remains on the new name. |
| collision | Existing feature_split is untouched; the generated name is feature_split_split. Original source name/checkout and source/child trees remain intact. |
| patterns | sp with mixed -f/--file/--by-file flags selects overlapping refactor/test patterns once, including a space/Unicode filename. Only API changes remain in the feature delta. |
| file-types | Selected old assets paths carry deletion and binary changes into the parent. A cross-directory rename is separated into old-path deletion in the parent and unselected new-path addition in the remainder. Source/child trees remain exact. |
| occupied-child | Graphite publishes the split and exits zero while explaining that an occupied child was skipped. The child tip and dirty linked documentation survive, but child history remains behind the rewritten source. |
| cwd | Running from the source subdirectory with a relative refactor pattern produces the same selected entries as the repository-root invocation. |
| conflict | A valid already-stale child has an edit overlapping an unapplied source advance. Splitting a different path completes extraction and then stops at a real unmerged child rebase, exit 1. |
| continue | After deliberate fixture resolution/staging, a new gt continue process exits zero, retains the resolution, completes child ancestry, and returns to feature cleanly without duplicate extraction. Git's editor is explicitly true for continuation; no metadata-editor interaction is claimed. |

All nine new REA results are complete and untruncated. Ordinary successful probes preserve main and the unrelated other stack. Per-case folders retain before/after/capture records; the conflict folder also retains partial state, actual rebase evidence, staged resolution and the separate continue capture. The portable REA bundle includes earlier demonstration records as well; current case IDs distinguish this round.

A synchronized child rebased onto an identical source tree is not a credible natural conflict fixture. The stale-child setup supplies a genuine content difference. Consequently old descendant tip-tree preservation applies to synchronized, nonconflicting input; stale replay and user conflict resolution can legitimately change those trees.

## Explicit Anthracite decisions

1. Refuse complete selections before effects to preserve the original branch/PR identity. Do not copy Graphite's original-name deletion or introduce an empty-source model.
2. Refuse occupied/frozen mandatory participants before extraction; do not copy an occupied-child skip after source rewriting. Unchanged ancestors remain read-only anchors.
3. Use exact net-tree projection with independently selected rename endpoints and Git entry bytes/modes. Refuse structurally impossible partial file/directory projections without enlarging selection. No-match, unchanged-only and complete selections refuse early.
4. Allocate the first safe available repeated _split name, including ref namespace checks. Flatten linear source history to two generated commits with invoking identity and oldest-first complete messages. Only simple-message joins, the recorded author environment and one exact collision were measured; broader body normalization and ref allocation are explicit contract decisions.
5. Require the source aligned to its current parent and linear mandatory replay segments. Allow a valid stale child, retain real conflict state and continue only actual saved replay. Do not redo extraction or promise total rollback.

## Current source and reused mechanisms

The [command](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/commands/split.ts#L5-L40) offers commit/hunk styles only. The [action](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/actions/split.ts#L23-L88) requires prompting and applies branch changes before generic descendant restack. Existing branch application retains local prInfo on the original name; it is a building block, not an atomic transaction or file-mode implementation.

Source research identified context repair before action checks and generic frozen-restack skips without a recognized mandatory role. The spec therefore requires early read-only planning and a minimal durable split role in existing continuation when necessary. Supporting source notes and the conflict-fixture addendum cite the existing validation, base/ownership, collision and recovery mechanisms. Preliminary recommendations in those notes are not the final contract; the specification governs where probes led to different choices, including effective-cwd-relative pathspecs. Their analyses are not runtime acceptance of future Anthracite behavior.

The draft was checked against all six approved groups. Two ambiguities were corrected: an unrepresentable tree projection refuses, and an ordinary naming collision must allocate a valid suffix when available. This is a contract consistency check, not a product code-review/test result.

## Limits and replay

These probes do not establish a complete frozen/worktree/hook/error matrix, arbitrary body normalization, merge topology, submodule behavior, live PR identity, cancellation equivalence or all-platform certification. The specification assigns bounded future acceptance or explicit exclusions to those matters.

REA samples processes and prelaunch executable identity, without atomic OS-image binding, syscall tracing or network observation. No REA filesystem observation paths were selected; independent Git records provide the declared state evidence. Isolated config, absent remotes and gh sentinels are not a network sandbox. The earlier incomplete dirty capture remains incomplete in its original record and is not upgraded by these new probes.

Run the evidence checker for hashes and independent outcome predicates. Replay requires a fresh root and pinned executables; retained setup scripts contain original host paths and must be pointed at the fresh root and included demo fixture. They refuse existing case directories. No existing project, live PR, installation or CI workflow was modified by the probes. This publication creates a specification issue, not implementation or tickets.

Primary references: [Graphite command reference](https://graphite.com/docs/command-reference#gt-split), [Graphite split tutorial](https://graphite.com/docs/squash-fold-split), [Git pathspec glossary](https://git-scm.com/docs/gitglossary).
