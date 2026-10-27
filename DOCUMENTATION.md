# Anthracite command reference

Anthracite is an open-source fork of the Graphite CLI for working with stacked branches and pull requests on GitHub. The command is `an`.

> **Using Graphite alongside Anthracite?** Use `an` for Anthracite and `gt` for Graphite. Modern top-level names and the twenty supported short forms are listed in [COMPATIBILITY.md](./COMPATIBILITY.md), together with retained legacy entries and explicit feature limits. This reference describes the source candidate, independently of any installed release.

---

## Concepts

- **Stack** — a chain of dependent branches, each based on the one below it. Anthracite tracks the parent/child relationships so it can keep the whole chain rebased and submitted together.
- **Trunk** — your repo's base branch (e.g. `main`). Every stack starts from trunk.
- **Downstack** — the branches *below* the current one, toward trunk (its ancestors).
- **Upstack** — the branches *above* the current one, away from trunk (its descendants).

When a command "restacks", it rebases each affected branch onto its parent so the stack stays consistent.

---

## Global options

Every command accepts these:

| Flag | Description |
| --- | --- |
| `--cwd <directory>` | Select a repository before or after a Anthracite command. Raw Git accepts the existing direct prefix form. Relative paths resolve from the process directory. |
| `--interactive` / `--no-interactive` | Default: both stdin and stdout must be terminals. Explicit interactive enables supported prompts/editors in pipes; quiet disables interaction. |
| `-q`, `--quiet` | Suppress progress/tips and interaction. Inspection and help/completion data retain their output. Errors stay on stderr. |
| `--verify` / `--no-verify` | Run commit/push hooks by default; disable them on those existing paths. This does not disable all Git rebase hooks. |
| `--debug` | Display debug output. |
| `--help` | Show help for any command. |
| `--version` | Show the installed version. |

**Environment overrides** (apply to a single invocation):

- `CH_EDITOR` — override the editor Anthracite opens.
- `CH_PAGER` — override the pager Anthracite opens.

---

## Frozen branch status

`an freeze [branch]` marks the selected tracked branch and its downstack before trunk as frozen. `an unfreeze [branch]` makes the selected branch and every tracked descendant editable, including branching descendants. Both default to the current branch. An explicit local branch selector also works with detached HEAD; trunk, untracked names and invalid scopes are refused before any status writes. There are no extra branch or force flags.

Status persists across processes and linked worktrees. Setting it does not checkout, stage, open an editor, invoke hooks, repair metadata or clear a saved conflict. Dirty and ignored files stay intact. Repeating the same request does not rewrite status refs; the complete validated status set is published in one Git ref transaction.

`an info`/`an i`, default `an log`/`an l`, and `an log short`/`an log s`/`an ls` show `(frozen)`. Classic and Git-based long logs (`log long`, `log l`, `ll`) retain their existing format. Navigation, parent/children, diff, patch and stat inspection remain available. Completion includes frozen local selectors without changing status; freeze/unfreeze have no extra aliases.

Content edits through modify/m (including interactive rebase), edit/e, squash/sq, split/sp and pop refuse a frozen source before staging, prompts, editors or hooks. Move, fold, reorder/ro and create/c --insert refuse frozen mandatory parent-change or replay participants before effects. A frozen destination may remain an unchanged anchor. Ordinary create/c, including --onto/-o, creates an editable child above a frozen parent. Generic restack/r skips frozen branches, explains the skips outside quiet and replays editable descendants against their actual parent tips. Force and no-verify never imply unfreeze.

Rename/rn, track/tr and untrack/ut/utr remain administrative operations under their existing rules. Rename preserves status and PR data, including frozen children; retrack keeps existing stored status. Untrack removes only the status belonging to removed tracking, so a later genuinely new tracking is editable. Local delete/dl may remove a frozen target under existing merge, force and worktree rules. A surviving frozen branch that must be reparented or replayed blocks deletion; sync cleanup skips the blocked candidate and dependent ancestors while independent safe cleanup may proceed. Explicit init --reset removes the affected tracking/status; ordinary rebuild preserves it. A frozen new trunk must first be unfrozen unless the existing full reset is explicitly selected.

New get/g imports use per-branch PR author/current gh-login matching: verified own branches are editable, other or unknown authors are frozen. --unfrozen/-U overrides only new imports. Existing stored status survives no-op, fast-forward, permitted remote overwrite and force/U. Frozen divergence requires explicit remote overwrite or unfreeze before local replay. Sync retains its existing trunk/PR/cleanup/optional-restack scope; use get for feature-head updates. Submit/s/ss skips frozen heads before push, PR edits, editors and reviewer/draft/publish preparation. Editable descendants may still submit with the frozen parent as base; all-frozen selections are explained successful no-ops. Dry-run uses the same selection.

Fresh continue/cont checks the actual active replay and remaining mandatory participants before --all staging and each next step. A later generic frozen queue item may skip. Early refusal preserves the active rebase, resolution/index and continuation; explicit unfreeze permits a valid resume. Original editor/hook work and already completed commits or parent updates can remain after a late refusal. Diagnostics describe that reached state. Existing raw rebase --abort aborts the active Git rebase, without promising to undo earlier branch or status changes.

The existing cwd, quiet, interaction, dirty-file and linked-worktree protections still apply. Quiet suppresses ordinary successes/skips and retains errors and exit status. Scoped guards recheck after managed external editors/hooks and before the next actual mutation; they do not provide a general cross-process lock or rollback. Freeze is not deletion protection or an operating-system lock: direct Git, existing raw Git passthrough (for example reset or rebase) and internal debug metadata editors are outside the enforcement contract. See [COMPATIBILITY.md](./COMPATIBILITY.md#frozen-branch-compatibility) for the measured Graphite choices, controlled-service evidence and validation limits.

## Create & modify

### `create` (alias `c`)
Create a new branch stacked on top of the current branch and commit staged changes. If no branch name is given but a commit message is passed, the branch name is generated from the message.

| Flag | Description |
| --- | --- |
| `[name]` | Positional: name for the new branch. |
| `-o`, `--onto` | Create above an explicitly selected tracked local branch or trunk. |
| `-m`, `--message` | Commit staged changes on the new branch with this message. |
| `-a`, `--all` | Stage all unstaged changes before committing. |
| `-p`, `--patch` | Pick hunks to stage before committing. |
| `-i`, `--insert` | Existing children of the selected parent (`--onto`, otherwise current branch) become children of the new branch. |

```
an create -am "Add login form"
```

### `modify` (alias `m`)
Modify the current branch by amending its commit (or creating a new one with `--commit`) and restack upstack branches. **Amends by default.**

| Flag | Description |
| --- | --- |
| `-a`, `--all` | Stage all changes before committing. |
| `-c`, `--commit` | Create a new commit instead of amending the current one. |
| `-m`, `--message` | The message for the commit. |
| `-e`, `--edit` / `-n`, `--no-edit` | Whether to edit the existing message when amending (`--no-edit` takes precedence). |
| `-p`, `--patch` | Pick hunks to stage before committing. |
| `--interactive-rebase` | Edit the current branch’s commit sequence and restack descendants; replaces the ordinary amend/create-commit operation when true. |

Explicit `--message` avoids the message editor; `--no-edit` takes precedence over `--edit`. Interactive rebase ignores ordinary operation options (`--commit`, `--all`, `--patch`, `--message`, `--edit`/`--no-edit`), while global cwd/quiet/interaction rules still apply. An occupied involved worktree is refused before the editor. A conflict can leave partial progress: resolve and run `an continue` or `an cont`; there is no general transaction rollback. `--interactive-rebase=false` retains ordinary modify behavior.

```
an modify -a            # amend current commit with all changes
an modify -c -m "Fix"   # add a new commit instead
```

### `squash` (alias `sq`)
Squash all commits in the current branch into one and restack upstack branches.

| Flag | Description |
| --- | --- |
| `-m`, `--message` | The updated message for the commit. |
| `--edit` / `-n`, `--no-edit` | Whether to modify the existing commit message (`--no-edit` takes precedence). |

```
an squash -m "Implement feature"
```

### `edit` (alias `e`)
Retained legacy entry for `an modify --interactive-rebase`: edit the current branch’s commits and restack descendants with the same editor and worktree guards.

```
an edit
```

### `split` (alias `sp`)
Split the current branch into multiple single-commit branches.

| Flag | Description |
| --- | --- |
| `-c`, `--by-commit`, `--commit` | Split by commit — slice up the branch's history. |
| `-h`, `--by-hunk`, `--hunk` | Split by hunk into new single-commit branches. |

```
an split --by-commit
```

### `fold`
Fold a branch's changes into its parent, update descendants' dependencies, and restack.

| Flag | Description |
| --- | --- |
| `--stack` | Fold the full trunk-to-tip feature chain into its original bottom branch, retaining separate commits. |
| `-k`, `--keep` | Ordinary fold keeps the current name; stack fold keeps the chosen tip name instead of the original bottom name. |

```
an fold
```

### `rename` (alias `rn`)
Rename a branch and update metadata referencing it. If no name is supplied, you'll be prompted. **This drops the local PR association; it does not close or delete the remote PR.** In non-interactive mode supply the new name.

| Flag | Description |
| --- | --- |
| `[name]` | Positional: the new branch name. |
| `-f`, `--force` | Allow renaming a branch already associated with an open PR. |

```
an rename better-name
```

### `delete` (alias `dl`)
Delete a branch and its corresponding Anthracite metadata.

| Flag | Description |
| --- | --- |
| `[name]` | Positional: branch to delete. |
| `-f`, `--force` | Delete even if the branch is not merged or closed. |

```
an delete old-branch -f
```

### `pop`
Delete the current branch but retain the state of files in the working tree.

```
an pop
```

---

## Navigate

### `checkout` (alias `co`)
Switch to a branch. With no argument, opens an interactive selector.

| Flag | Description |
| --- | --- |
| `[branch]` | Positional: branch to switch to. |
| `-u`, `--show-untracked` | Include untracked branches in the interactive selector. |

```
an co            # interactive
an co my-branch
```

### `up` (alias `u`)
Switch to the child of the current branch. Prompts if ambiguous.

| Flag | Description |
| --- | --- |
| `[steps]` / `-n`, `--steps` | Number of levels to traverse upstack (default 1). |

```
an up 2
```

### `down` (alias `d`)
Switch to the parent of the current branch.

| Flag | Description |
| --- | --- |
| `[steps]` / `-n`, `--steps` | Number of levels to traverse downstack (default 1). |

```
an down
```

### `top` (alias `t`)
Switch to the tip branch of the current stack. Prompts if ambiguous.

```
an top
```

### `bottom` (alias `b`)
Switch to the first branch from trunk in the current stack.

```
an bottom
```

---

## Stack operations

### `restack` (alias `r`)
Ensure each branch in the current stack is based on its parent, rebasing if necessary. Use scope flags to limit which branches are restacked.

| Flag | Description |
| --- | --- |
| `--branch` | Which branch to run from (default: current branch). |
| `-d`, `--downstack` | Only restack this branch and its ancestors. |
| `-u`, `--upstack` | Only restack this branch and its descendants. |
| `-o`, `--only` | Only restack this branch. |

```
an restack
an restack --upstack
```

### `move`
Rebase the current branch onto the latest commit of a target branch and restack all of its descendants. With no argument, opens an interactive selector.

| Flag | Description |
| --- | --- |
| `[branch]` | Positional: the target branch to rebase onto. |
| `-o`, `--onto` | Target tracked local branch or trunk, also accepted positionally. Both selectors must agree when supplied together. |
| `-s`, `--source` | Branch to rebase (defaults to current branch). |
| `--only` | Move only the selected source, leaving its children on its old parent; default moves its upstack too. |

```
an move main
```

Use `an move` for branch operations. `an mv` passes through to Git to move files; it is not a branch alias. A direct `--cwd` prefix may select another repository for this Git operation. Other global prefixes are not supported for raw Git routing and never turn `mv` into a branch operation.

### `reorder` (alias `ro`)
Reorder the branches between trunk and the current branch, restacking all descendants. Opens an interactive editor. `--stack` selects the full trunk-to-tip feature chain in a top-first editor and returns to the original departure branch.

```
an reorder
```

### `track` (alias `tr`)
Start tracking the current (or provided) branch with Anthracite by selecting its parent. Also used to fix corrupted Anthracite metadata.

| Flag | Description |
| --- | --- |
| `[branch]` | Positional: branch to track. |
| `-p`, `--parent` | The tracked branch's parent. If unset, prompts. |
| `-f`, `--force` | Set the parent to the most recent tracked ancestor. Takes precedence over `--parent`. |
| `-d`, `--downstack` | Track a chain of untracked branches downstack, from the current branch down to the first tracked branch. |

```
an track -p main
an track --downstack
```

### `untrack` (aliases `utr`, `ut`)
Stop tracking a branch with Anthracite. If it has children, they are also untracked. Defaults to the current branch.

| Flag | Description |
| --- | --- |
| `[branch]` | Positional: branch to untrack. |
| `-f`, `--force` | Don't prompt before untracking a branch with children. |

```
an utr feature-x       # modern short form; an untrack and an ut remain available
```

### `test`
Run a command on each branch in the current stack and aggregate the results. Use scope flags to limit which branches run.

| Flag | Description |
| --- | --- |
| `<command>` | Positional: the command to run on each branch. |
| `-d`, `--downstack` | Run from trunk to the current branch. |
| `-u`, `--upstack` | Run on the current branch and its descendants. |
| `-t`, `--trunk` | Also run on the trunk branch. |

```
an test "npm test"
an test --upstack "npm run lint"
```

### `continue` (alias `cont`)
Continue the most recent Anthracite command halted by a merge conflict (e.g. during a restack or sync).

| Flag | Description |
| --- | --- |
| `-a`, `--all` | Stage all changes before continuing. |

```
an continue -a
```

---

## Submit & sync

### `submit` (alias `s`)
Idempotently force-push all branches from trunk to the current branch to GitHub, creating or updating a distinct PR for each. **Defaults to the current downstack** (trunk → current); pass `--stack` to also include descendants. `an ss` uses that whole-stack scope by default and accepts the same options. Explicit later `--no-stack` or `--stack=false` overrides the `ss` default; a later `--stack=true` enables it again. `--branch` selects the starting branch for either short form.

| Flag | Description |
| --- | --- |
| `-s`, `--stack` | Also submit the current branch's descendants, in addition to its ancestors. |
| `-d`, `--draft` | Create drafts or turn existing ready PRs into drafts. Conflicts with `--publish`. |
| `-p`, `--publish` | Create ready PRs or publish existing drafts, including without interaction. With neither flag, new non-interactive PRs default to draft; existing status is retained. |
| `-e`, `--edit` / `-n`, `--no-edit` | Edit PR fields inline. `--no-edit` takes precedence. |
| `-r`, `--reviewers` | Prompt for reviewers, or pass a comma-separated list. |
| `--dry-run` | Report which PRs would be submitted, then exit. Nothing is pushed. |
| `-c`, `--confirm` | Report the PRs and ask for confirmation before pushing. Ignored with `--no-interactive`/`--dry-run`. |
| `--select` | Report the PRs and ask which to update/create. Ignored with `--no-interactive`/`--dry-run`. |
| `-u`, `--update-only` | Only update PRs that have already been submitted. |
| `-f`, `--force` | Force push (overwrites remote). Otherwise defaults to `--force-with-lease`. |
| `--always` | Always push updates even if the branch is unchanged. |
| `--branch` | Which branch to run from (default: current branch). |

```
an s                   # submit trunk -> current
an ss -d               # whole selected stack, as drafts
an ss --no-stack       # explicit downstack override
an ss --branch target --dry-run
```

### `sync`
Pull the trunk branch from remote and delete any branches that have been merged. If trunk can't be fast-forwarded, it is overwritten with the remote version.

| Flag | Description |
| --- | --- |
| `-p`, `--pull` | Pull the trunk branch from remote (default on). |
| `-d`, `--delete` | Delete branches that have been merged (default on). |
| `--show-delete-progress` | Show progress through merged branches. |
| `-f`, `--force` | Don't prompt before deleting a branch or resetting trunk to remote. |
| `-r`, `--restack` | Restack the current stack and any stacks with deleted branches. |

```
an sync
an sync -fr
```

### `auth`
Authenticate with the GitHub CLI so Anthracite can create and manage PRs.

Anthracite uses the existing `gh` authentication flow. Graphite token input via
`--token` or `-t` is not supported and is refused before any authentication tool
or configuration changes. Run `an auth` from an interactive terminal when login
is needed; an already authenticated GitHub CLI can be checked without interaction.

```
an auth
```

---

## Collaborate

### `get` (alias `g`)
Get branches from trunk to the specified branch from remote, prompting to resolve conflicts. With no argument, gets downstack from the current branch. Useful for pulling a teammate's stack.

| Flag | Description |
| --- | --- |
| `[branch]` | Positional: branch or numeric PR number to fetch down to. Omit for the current branch. |
| `-f`, `--force` | Overwrite all fetched branches with the remote source of truth, preserving existing frozen status and work/worktree checks. |
| `-U`, `--unfrozen` | Make only new imports editable. Default false, including explicit `--unfrozen=false`. |

```
an get teammate-branch       # protect new imports from other or unknown authors
an g 123 -U                  # explicitly make new imports editable
```

Each new import is frozen unless its PR author login matches the current `gh` account login, or `--unfrozen` is true. A mixed stack is decided per branch. Missing, invalid or unavailable optional identity information conservatively means frozen; the required PR head/base chain must still resolve to trunk. Anthracite uses read-only `gh` requests and does not infer ownership from Git names or email or start a login flow.

Existing tracked branches keep their current status through no-op, fast-forward and permitted remote overwrite, even with force or `-U`. Frozen divergence offers remote overwrite or abort; use explicit `an unfreeze` before local replay. An editable get rebase conflict saves the pending new-import decisions for a fresh `continue`/`cont`; account changes do not change those saved defaults. An active replay that becomes frozen stops before `--all` staging until explicitly unfrozen. Late failures report reached refs and unfinished metadata/status publication; earlier imports remain completed.

These behaviors are tested against controlled external `gh` responses and local bare remotes, not a live Graphite service.

---

## Inspect

### `log` (alias `l`)
Command group that logs your stacks.

- `an log` (default) — log all branches tracked by Anthracite, showing dependencies and info for each.
- `an log short` (alias `s`) — log all stacks, arranged to show dependencies.
- `an log long` (alias `l`) — display a graph of the commit ancestry of all branches.

Shared flags (on `an log` and `an log short`):

| Flag | Description |
| --- | --- |
| `--classic` | Use the existing classic stack renderer; other log display selectors are ignored. |
| `-r`, `--reverse` | Print the log upside down. |
| `-s`, `--stack` | Only show ancestors and descendants of the current branch. |
| `-n`, `--steps` | Only show this many levels up/downstack. Implies `--stack`. |
| `-u`, `--show-untracked` | Include untracked branches. |

Omitting `--steps` keeps the existing unlimited scope: all tracked branches by default, or the current branch's stack with `--stack`. An explicit `--steps 0` selects only the current tracked branch, with no ancestor or descendant branch nodes. Full output retains its own commit details; short output remains compact. The same rule applies through `an l`, `an log s`, `an l short`, `an l s` and `an ls`, and with `--steps=0`, `-n 0` or `-n0`.

Zero still implies current-branch selection with `--no-stack` or `--stack=false`; `--reverse` retains the same single node. An explicitly requested `--show-untracked`/`-u` section is separate from the tracked graph. A current trunk or empty tracked branch remains visible; detached HEAD and an untracked current branch fail with a meaningful error. Inspection preserves local work, stored branch state and saved recovery data.

Classic is available through `an log --classic`, `an l --classic`, `an log short --classic`, and `an ls --classic`; only the short forms also have `-c`. Without classic (or with `--classic=false`), the normal full/short style remains selected. Global cwd, quiet and interaction rules still apply. A configured pager receives classic content only when both stdin and stdout are terminals and interaction is allowed; pipes receive it directly.

### `ls`
Top-level shortcut for `log short`: log all stacks tracked by Anthracite, arranged to show dependencies.

| Flag | Description |
| --- | --- |
| `-c`, `--classic` | Use the old logging style (other log display selectors are ignored). |
| `-r`, `--reverse` | Print the log upside down. |
| `-s`, `--stack` | Only show ancestors and descendants of the current branch. |
| `-n`, `--steps` | Only show this many levels up/downstack. Implies `--stack`. |
| `-u`, `--show-untracked` | Include untracked branches. |

```
an ls
an ls -s
```

### `ll`
Top-level shortcut for `log long`: display a graph of the commit ancestry of all branches.

```
an ll
```

### `info` (alias `i`)
Display information about the current or selected tracked local branch.

| Flag | Description |
| --- | --- |
| `[branch]` / `--branch <branch>` | Choose a tracked local branch; defaults to current branch. If both are supplied, they must agree. |
| `-s`, `--stat` | Show diffstat instead of full patches. |
| `-p`, `--patch` | Show the changes made by each commit. |
| `-d`, `--diff` | Show the diff between this branch and its parent. Takes precedence over `--patch`. |
| `-b`, `--body` | Show the PR body, if it exists. |

```
an info -d
```

---

## Config

### `repo`
Read or write Anthracite's per-repo configuration. Sub-commands generally read the current value when run with no flag and write it with `-s`/`--set`.

| Sub-command | Description |
| --- | --- |
| `repo init` (alias `i`) | Create or regenerate a `.graphite_repo_config` file. Flags: `--trunk <name>`, `--reset` (untrack all branches). |
| `repo sync` (alias `s`) | Same as the top-level `sync` (pull trunk, delete merged branches). Flags: `-p`/`--pull`, `-d`/`--delete`, `--show-delete-progress`, `-f`/`--force`, `-r`/`--restack`. |
| `repo name` | The repo's name in Anthracite (e.g. `anthracite` in `danielbaars/anthracite`). `-s`/`--set` to override. |
| `repo owner` | The repo owner's name in Anthracite. `-s`/`--set` to override. |
| `repo remote` | The remote Anthracite pushes to / pulls from (defaults to `origin`). `-s`/`--set` to override. |
| `repo pr-templates` | List your GitHub PR templates, used to pre-fill PR bodies on submit. |
| `repo github` | Toggle the GitHub integration for this repo. `--enable` to set on/off. |

```
an repo init --trunk main
an repo remote -s upstream
```

> The previous command name `repo disable-github` is now `repo github` (toggle via `--enable`).

### `user`
Read or write Anthracite's user-level configuration. Sub-commands read the current value with no flag and write it with the flags below.

| Sub-command | Description |
| --- | --- |
| `user editor` | The editor Anthracite opens. `--set <editor>` (e.g. `--set vim`), `--unset`. |
| `user pager` | The pager Anthracite opens. `--set "less -FRX"`, `--disable`, `--unset` (fall back to git's pager). |
| `user tips` | Show tips while using Anthracite. `--enable`, `--disable`. |
| `user branch-prefix` | Prefix prepended to generated branch names. `-s`/`--set <prefix>`, `-r`/`--reset` (takes precedence over `--set`). |
| `user branch-date` | Prepend the date to auto-generated branch names. `--enable`, `--disable`. |
| `user branch-replacement` | Character that replaces unsupported characters in generated branch names. `--set-underscore`, `--set-dash`, `--set-empty`. |
| `user restack-date` | How committer date is handled by restack's internal rebases. `--use-author-date` passes `--committer-date-is-author-date`. |
| `user submit-body` | Defaults for PR descriptions. `--include-commit-messages` includes commit messages in the PR body by default. |

```
an user editor --set "code --wait"
an user branch-prefix -s dane/
```

---

## Setup & misc

### `init`
Create or regenerate a `.graphite_repo_config` file for the current repo (same as `repo init`).

| Flag | Description |
| --- | --- |
| `--trunk` | The name of your trunk branch. |
| `--reset` | Untrack all branches. |

```
an init --trunk main
```

### `completion`
Print a yargs bash/zsh completion script to stdout for the current shell. Root candidates include supported aliases; command option queries use their actual builders. Cwd selects branch candidates without prompts or a pager. Fish generator content is checked separately; full interactive fish behavior is not certified.

```
an completion >> ~/.bashrc
```

### `fish`
Set up fish-shell tab completion.

```
an fish
```

### `feedback`
Command group for providing feedback and debug state.

- `an feedback debug-context` — print a debug summary of your repo, useful for bug reports.

```
an feedback debug-context
```

### `demo`
Run an interactive demo of Anthracite.

```
an demo
```
