# Insert a prerequisite below selected children

`an create` (alias `an c`) creates above the current tracked branch or trunk.
Use `--onto parent` to choose another tracked local parent without checking it
out first. `--insert` (alias `-i`) makes chosen existing direct children of that
parent children of the new branch and replays their necessary descendants.

```sh
an create shared --onto base --insert --insert-child left -m "Add prerequisite"
an c shared -i --insert-child left --insert-child right -m "Add prerequisite"
```

Stage intended work with Git first, or deliberately use create's existing `--all`
or terminal `--patch` input options. The child choices are resolved before
staging, patch selection, commit editing or branch creation. Explicit child
choices suppress only the child menu; ordinary input/editor requirements remain.

Each `--insert-child` consumes one exact, nonempty literal branch name. Repeat
it to choose several children; duplicates act once. Commas, Unicode and
numeric-looking names retain their spelling. Names are not comma-separated
lists, patterns or prefixes. Every name must be a tracked local direct child of
`--onto`, otherwise of the current branch or trunk. A grandchild, unrelated
branch, unknown name, missing value or selector without active `--insert`
(including `--no-insert`) refuses the entire request before insertion effects.
The option does not enable insertion itself or prescribe sibling replay order.

Without explicit choices, multiple children open a terminal menu naming the
chosen parent and children. All are initially selected and at least one must
remain selected. Cancel before confirmation to retain checkout, refs, staging
roles and working files. Zero or one child needs no menu. Non-TTY input,
`--no-interactive` and `--quiet` retain the established all-children default;
forcing `--interactive` without a usable terminal also keeps that default.
Explicit choices remain authoritative in every mode. Normal progress names the
chosen parent and children; quiet suppresses routine progress and prompting,
while retaining actionable errors and recovery guidance. `--cwd` and invocation
from repository subdirectories select the same effective repository.

Only chosen children change direct parent. Their necessary descendants retain
own commit history and local PR identity during replay. Unselected arms retain
refs and parent relationships, including independent frozen branches and dirty
foreign worktrees. Selected direct children are mandatory even for an empty
insertion. Frozen or occupied mandatory descendants refuse before creation;
unchanged read-only anchors retain their existing treatment. Relevant source,
parent and chosen state is rechecked after waiting at the menu.

A genuine replay conflict returns nonzero and reports the reached state. Inspect
`git status`, resolve deliberately, stage only the resolution, then run
`an continue` in a fresh process. Continuation retains the original selected
scope; pending mandatory participants are rechecked before `--all` stages or
advances. Completed replays remain completed. Raw `git rebase --abort` only
cancels the active rebase: it does not remove the inserted branch/commit or undo
parent changes and completed replays. Existing legacy insert recoveries remain
supported.

Agents use the same two [MCP tools](mcp.md): read `learn_an`, then call
`run_an_cmd` with literal arguments, an absolute `cwd` and a reason:

```json
{
  "args": ["create", "shared", "--onto", "base", "--insert", "--insert-child", "left", "-m", "Add prerequisite"],
  "cwd": "/absolute/project",
  "why": "Insert the approved prerequisite beneath left"
}
```

MCP is noninteractive, so omit the child option only when moving all children is
intended. Insertion does not push or change PRs. Discovery, learning and local
execution retain the existing publication approval process and authentication
boundaries; no new tool, transport or account is required.
