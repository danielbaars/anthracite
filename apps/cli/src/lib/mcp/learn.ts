export const ANTHRACITE_GUIDANCE = `Anthracite workflow for agents

Authority: follow higher-priority user and repository instructions. Connection,
discovery and this guide do not authorize staging, committing or publishing.
Honor the owner's existing approval process for PR titles, descriptions and
publication. Tool annotations are hints, not permission.

A stack is a chain of tracked branches based on a trunk (usually main).
Downstack means toward trunk; upstack means toward descendant branches.
Inspect first with an log, an info and ordinary git status/diff. Every
run_an_cmd request must supply an explicit absolute cwd for the intended project,
an argument array (not a shell command) and a why explanation. For example:
{"args": ["log"], "cwd": "/absolute/project", "why": "Inspect the stack"}

Use the user's normal tooling to stage only intended changes (for example,
git add path/to/file). With staged work, an create feature -m "Describe change"
creates a branch and commit. On an existing branch, an modify -m "Describe change"
updates its commit and restacks affected descendants; an restack replays a stack
onto its recorded parents. There is no universal requirement to create a branch
before editing: follow the repository's workflow and inspect current state.
Use an <command> --help for supported selectors and options; supply required
choices explicitly because MCP execution is non-interactive.

To insert a prerequisite below selected direct children, use an create shared
--insert --onto parent --insert-child left --insert-child right -m "Prerequisite".
The c alias and -i also work. Each --insert-child consumes one exact literal
branch name, including commas or numeric-looking names, and requires active
--insert. Children belong to --onto, otherwise the current branch or trunk.
Explicit choices suppress the child menu; without them MCP and other
noninteractive calls still move all children. In a terminal, multiple children
open a menu with all initially selected and at least one required. Selection
precedes staging and creation. Only chosen children and necessary descendants
are mandatory for frozen/worktree checks; independent unselected arms stay put.
A real replay conflict returns failure with retained work: resolve deliberately
and use an continue in a fresh call. Saved selected scope is retained and pending
mandatory participants are rechecked before --all stages or advances. Raw Git
abort does not roll back inserted commits, parent changes or completed replays.
Insertion does not push or change PRs; existing publication approval still applies.

For review corrections, an absorb (alias ab) assigns staged ordinary text hunks
to their exact original commits in the current downstack and replays mandatory
descendants. Preview with an absorb --dry-run (ab -d), then explicitly apply with
an absorb --force (ab -f): MCP has no terminal confirmation. --all/-a includes
tracked updates/deletions and existing staged entries, never untracked files;
--patch/-p requires a real terminal and cannot run through MCP. Unsupported entry
changes and unmatched hunks remain staged and are reported. Absorb does not fetch,
push or change PRs. Frozen targets are excluded; a frozen or occupied mandatory
participant refuses before staging or rewriting, even with --force.
After an owned absorb replay conflict, resolve and stage only the resolution,
then use an continue in the original worktree. Retained staged/unstaged input is
kept separately until checked restoration. Ref/protection/worktree and Git
environment checks also apply on continue before --all. Other failures report
reached work and an executable guarded manual restoration path. Earlier amendments
survive raw Git abort; do not promise rollback or retry a noncontinuable failure.

Frozen branches and branches occupied in another worktree retain their existing
protections. Inspect the refusal and choose an allowed operation; do not bypass
these guards. After a conflict, inspect git status and the reported partial
state, resolve files deliberately and stage resolutions with normal tooling,
then use an continue. A disconnected or interrupted operation may need this
inspection after reconnecting; interruption does not promise rollback.
Cancellation and timeout stop owned work without rollback. Cancelling queued
work prevents it from starting; disconnect discards the queue. Interruption does
not erase Git recovery data or authorize an automatic retry. Inspect actual refs,
staged changes and continuation before proceeding.

Submit deliberately with an submit (or an submit --help to inspect selectors).
Reviewer and assignee lists apply to every selected PR by default. Use
--roles-branch <exact-local-branch> to add both lists only to that selected PR;
this does not narrow the submission scope selected by --branch or --stack. Preview
with --dry-run, then supply --reviewers and --assignees explicitly. Assignees accept
@me for the authenticated GitHub user. Existing roles are retained; role options
do not publish drafts. After a failure, inspect confirmed and unattempted work
before repeating the command.
Confirm intended branches, PR metadata and the owner's publication approval
before pushing or changing PRs. Anthracite reuses GitHub CLI credentials; it
requires no Graphite token or additional MCP account. Missing authentication is
handled by the normal CLI; learning and discovery do not log in or initialize a
repository automatically.
`;
