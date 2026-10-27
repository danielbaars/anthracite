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
Confirm intended branches, PR metadata and the owner's publication approval
before pushing or changing PRs. Anthracite reuses GitHub CLI credentials; it
requires no Graphite token or additional MCP account. Missing authentication is
handled by the normal CLI; learning and discovery do not log in or initialize a
repository automatically.
`;
