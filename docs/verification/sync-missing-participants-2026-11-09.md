# Missing sync participants: public 0.6.15 practical probes

Three synthetic cases for [#153](https://github.com/danielbaars/anthracite/issues/153) were exercised on 2026-11-09 through the public npm **0.6.15** CLI. The safe exit delivered by [#152](https://github.com/danielbaars/anthracite/issues/152) works in these cases. Starting a new sync is not, by itself, a complete dependency-repair workflow: divergence can require a separate decision, and a fresh sync can return zero while an orphan remains preserved but untracked.

## Boundary and retained evidence

Each case uses an independent real Git repository and local bare remote, with the existing `FrozenGetFixture` controlling only external `gh` answers. The affected missing/reused branches are local-only. The published implementation source is [commit c1ee9a4](https://github.com/danielbaars/anthracite/commit/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a); the executable's `--version` is asserted as 0.6.15 in every case. See [environment](evidence/sync-missing-participants-2026-11-09/environment.json), [portable probe](evidence/sync-missing-participants-2026-11-09/probe.cjs) and [checksums](evidence/sync-missing-participants-2026-11-09/SHA256SUMS).

The common sequence is:

```text
main → parent → child → affected local branch [→ surviving child]
incoming parent update → child restacked → genuine conflict on affected branch
raw git rebase --abort → checkout main → external deletion/recreation
continue --all → preserving ls → sync --abort → fresh default sync
```

All three therefore cover a saved sync whose live Git rebase has already been aborted. They do not demonstrate skipping participants while a matching live rebase remains active. Raw Git abort and external branch deletion/recreation are explicit fixture actions, not effects attributed to `sync --abort`.

## Common preservation results

In all three records:

- `continue --all` exits **1** with `No matching owned active sync rebase`, preserving all observed state. This refusal happens before a live participant check; it must not be presented as a separate test of changed-head refusal during an active rebase.
- Pending `ls` exits **0**, preserving the same refs, metadata, checkout, index, files, recovery bytes and source pins.
- `sync --abort --no-interactive` exits **0**. The original recovery bytes are retained exactly in its private archive, the active sync record is released, and all other observed state and existing source pins remain unchanged.
- Earlier incoming updates and the completed local restack of `child` remain applied. Abandonment does not resume the old queue or restore the intentionally removed/replaced branch.

The records retain command stdout/status, complete measured snapshots, original archive-byte checks and controlled GitHub requests/responses: [missing leaf](evidence/sync-missing-participants-2026-11-09/missing-leaf.json), [missing parent](evidence/sync-missing-participants-2026-11-09/missing-parent.json), [reused name](evidence/sync-missing-participants-2026-11-09/reused-name.json).

## First fresh sync: an independent divergence barrier

The first fresh default `sync` exits **1 in every case**. The earlier sync had already restacked local `child`, but sync does not publish that rewritten head. Its remote still holds the previous commit. The next invocation therefore asks for an explicit reconciliation decision and refuses unattended execution:

```text
ERROR: Local branch child has diverged from remote.
Retry sync interactively to choose a resolution.
```

That refusal is a distinct guard, not proof that the disappeared participant is still blocking. It also does not mean no metadata was changed: normal context initialization prunes the disappeared branch's metadata. In the reused-name case it repairs the replacement branch's stored parent revision before the later divergence refusal.

### Controlled retry to isolate dependency handling

Each retained record then includes one explicit external control: a leased push aligns only the **synthetic bare remote's `child`** with the already reached local `child` tip, and a fetch/ref update aligns the controlled PR producer with that same head. The probe verifies that the measured local branch/metadata refs, checkout, index, files, recovery and source pins do not change during this control. Remote and remote-tracking state intentionally change.

This is experimental isolation, **not a user recovery prescription**, an automatic action of Anthracite, or permission to force-push a real project. It removes the known local/remote mismatch without fixing the disappeared participant's local dependencies. The subsequent default `sync` exits **0 in all three cases**; that zero has different implications in the table below. In the JSON, `freshSyncStatus` records the first refusal and `alignedRemoteControlStatus` records this controlled retry.

## Outcomes after the controlled retry

| Case | Reached state | Meaning |
|---|---|---|
| Missing leaf `obsolete-leaf` | Sync exits 0; remaining `parent`/`child` stay valid; the missing leaf is not recreated. | Abandonment plus a fresh plan can complete the remaining valid graph once independent divergence is reconciled. |
| Missing parent `obsolete-parent` with `surviving-child` | Sync exits 0, but `surviving-child` retains its exact tip and own file, still names the absent parent in metadata, and is absent from ordinary `ls`. Explicit `info --branch surviving-child` exits 1 as untracked. | No commit loss was observed, but the subtree was **preserved outside the selected workflow, not repaired or replayed**. A generic success status is insufficient recovery guidance. |
| Reused name `reused-work` | The name is recreated on the **current `child`** with a distinct commit/message/tree and `replacement.txt`. Its tip, author, complete message and tree remain exact. Its parent revision is repaired and it appears in the final stack. | A fresh plan can accept this structurally compatible replacement without resurrecting old work. This does not establish safety for arbitrary same-name recreation on a different base. |

The survivor remains at `6a841770bd7c37c299674e5901ea862d460e4854`; the replacement remains at `718e99ca4447bde25199a77d52c52dce84479460`. The actual replacement author is the fixture's **Get Test**, not a different person: explicit author environment variables take precedence over the fixture's config change. The probe does not establish cross-author behavior.

The old intentionally deleted/replaced target commit object is still readable at the end of each probe. That observation is **not** a permanent garbage-collection retention guarantee or restoration of the deleted branch. Existing abandoned source pins are separately checked as retained after the fresh sync.

## Source explanation and proposed direction

The seven relevant inspected files were fetched at the published commit and byte-compared with the local source used for analysis; all matched. The observed behavior agrees with these primary-source boundaries:

- [Continuation requires a matching live owned rebase](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/actions/sync/sync_recovery.ts#L214-L279). [Abandonment has separate local release authority](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/actions/sync/sync_abandon.ts#L38-L98).
- [Missing-parent children become invalid](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/lib/engine/parse_branches_and_meta.ts#L99-L143); [only `VALID` branches count as tracked](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/lib/engine/engine.ts#L675-L680). [Feature refresh skips the others](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/actions/sync/sync_refresh.ts#L150-L164).
- [Cleanup preserves excluded metadata-bearing branches as untouched](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/actions/sync/clean_branches.ts#L67-L74), and [completion rechecks their refs/metadata](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/actions/sync/sync_completion.ts#L35-L103). Preservation is consequently distinct from restored tracking.
- [Normal metadata parsing can prune missing refs](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/lib/engine/parse_branches_and_meta.ts#L17-L39) and [repair an editable branch's parent revision when the current parent is an ancestor](https://github.com/danielbaars/anthracite/blob/c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a/apps/cli/src/lib/engine/parse_branches_and_meta.ts#L186-L262).

For #153, keep the old-plan ownership/participant guards and use the existing supported safe exit. Prioritize an explicit diagnosis of unresolved metadata-bearing descendants, a deliberate parent/commit-boundary repair decision, and honest disclosure of the fresh plan's scope and independent divergence choices. A missing branch must not be booked as completed replay, and a surviving child must not silently be reparented to trunk. Consider a skip/resume interface only after those requirements reveal a concrete need beyond controlled abandonment and fresh planning.

## Reproduction and limits

Build the repository's existing test fixtures using `CONTRIBUTING.md`, install public npm 0.6.15 into an isolated prefix, then run the retained script with absolute paths:

```text
node probe.cjs FIXTURE_MODULE PUBLIC_CLI NEW_OUTPUT_DIRECTORY
```

`FIXTURE_MODULE` is the compiled `apps/cli/dist/test/lib/fixtures/frozen_get_cli.js`; `PUBLIC_CLI` is that isolated installation's `node_modules/.bin/an`. The script checks origin is its own synthetic bare remote before the leased alignment push.

These are three direct public-CLI scenarios with an explicit remote control, not a full acceptance matrix. No live GitHub PR changes, production code changes, user-project/installation edits, CI or full CI matrix runs were performed. Foreign/live-rebase skipping, dirty/frozen/worktree variations, prior cleanup deletions, published PR-name reuse and replacements on unrelated bases remain outside these probes.
