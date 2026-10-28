# Split committed files into a prerequisite

Use `an split` (alias `an sp`) to reorganize a tracked branch. Commit and hunk modes retain their existing interactive workflows. File mode accepts a deterministic selection and never opens an Anthracite selector, editor or pager:

```sh
an split --by-file 'src/shared/**' --file 'docs/shared.md'
an sp -f ':(literal)src/a[1].ts' --no-interactive
```

`--by-file`, `--file` and `-f` are equivalent repeatable selectors. Each can take multiple values; overlapping matches are applied once. Quote patterns so the shell passes literal arguments. Git pathspecs resolve from the effective working directory, including a global `--cwd`. Git top magic such as `:(top)src/shared` and exclusion magic such as `:(exclude)src/private/**` retain Git's semantics. Exclusions filter the selection; they are not independent additive matches.

File mode selects the net **committed** changes between the branch's recorded parent and tip. It does not stage or include local edits. Added, modified and deleted entries, binary bytes, executable modes and symlinks retain their Git contents. Rename endpoints are independent deletion/addition paths. Select dependent paths together for a file/directory replacement. Changed submodules and unsupported path encodings are refused.

The selected entries become one commit on a new editable parent. The current branch becomes one remainder commit on that parent. For example, `feature` above `main` becomes `main → feature_split → feature`; further occupied names receive another `_split` suffix. The original branch name, checkout, complete tip tree and local PR identity remain. The new parent has no copied PR identity. A complete selection is refused, as is a selection with no net matching changes: choose a proper, nonempty subset.

File mode **flattens** the branch's own linear history into those two commits. Both messages join the original complete messages oldest to newest with a blank line between them, using the invoking Git author and committer identity. Old commit IDs, authors, signatures, timestamps and boundaries are not preserved. Choose `--by-commit` when commit boundaries matter. Active file, commit and hunk modes cannot be combined.

All tracked descendants are mandatory and replay parent-first. Already synchronized, nonconflicting descendants retain their resulting trees. A stale descendant receives current source changes and can conflict; its old tree is not guaranteed. Trunk and unrelated stacks stay unchanged. Success means the entire mandatory replay completed and the original branch is checked out again. No fetch, push or PR update occurs.

## Preconditions and recovery

Invoke file mode from an ordinary worktree without `GIT_INDEX_FILE`, `GIT_DIR`, `GIT_WORK_TREE` or `GIT_COMMON_DIR` redirections. The source must be tracked, non-trunk, linear, clean of tracked staged/unstaged edits, and restacked on its current parent. Frozen or externally checked-out mandatory branches, active interrupted operations and interfering untracked/ignored files are refused before extraction. Unchanged frozen/occupied ancestors are read-only anchors. Unrelated untracked/ignored files are preserved; no automatic staging, stashing, tracking or protection override occurs.

Real commit hooks run for both generated commits in an owned detached temporary worktree. Ignored project tooling (for example `node_modules`) may be unavailable there. Existing `--no-verify` is passed to those Git commits with Git's normal verification scope; it does not disable protection checks or all hooks during descendant replay. A failure is not automatically retried with hooks bypassed. Inspect the reported failure and any retained temporary path; hook-created files and locks are preserved instead of being deleted as cleanup.

Before extraction is published, construction failures do not publish a successful split. After extraction, a replay failure can leave the new parent, rewritten source and earlier replays completed. Diagnostics identify the reached phase, completed/pending branches and actual next command. For a real Git conflict, resolve and stage the files, then run `an continue` in a fresh process. Continuation rechecks refs, protection and worktree availability before advancing; refusal retains staged resolutions. A hook failure without an active rebase instead reports explicit manual restack/recovery instructions. Follow the command actually printed.

There is no universal rollback or new split abort command. `git rebase --abort` affects only the active rebase and does not undo an already published extraction. Hooks and concurrent external work are not sandboxed or rolled back. Inspect actual refs, tracking and working state after interruption.

## Scripts and agents

File mode works with closed stdin, `--no-interactive`, an ordinary terminal and `--quiet`. Normal output identifies extraction and replay; quiet suppresses routine progress while preserving actionable errors/conflicts. A nonzero result can describe a partial replay, so do not assume nothing changed or automatically retry the split.

The existing MCP `run_an_cmd` tool invokes this same command with literal argv and an explicit cwd. Its success/error envelope, timeout and cancellation behavior are unchanged; it adds no durable split job or rollback guarantee. See [MCP execution and recovery](mcp.md). Use `an split --help` and shell completion for the executable options. These bounded behaviors do not imply complete Graphite parity.
