# Anthracite over MCP

`an mcp` and `anthracite mcp` start the same local stdio MCP server, bundled with the CLI. Use a build that includes the `mcp` command; `an mcp --help` shows its options. The server identifies itself as `anthracite` with that build's package version and supports protocol versions `2024-11-05` and `2025-11-25`.

## Connect a local client

Adapt this generic configuration to your client's local stdio server settings:

```json
{
  "mcpServers": {
    "anthracite": {
      "command": "/absolute/path/to/an",
      "args": ["mcp"]
    }
  }
}
```

The installed alternate name works identically: replace the command with `/absolute/path/to/anthracite`. Choose one registration. Use the actual executable path on your machine; this example does not install a binary or change client settings. Clients launch the process and exchange MCP messages through stdin/stdout. There is no HTTP listener, port, separate MCP account or Graphite service connection.

Startup, initialization, discovery and learning work outside Git and without authentication. They do not initialize a repository, stage files, create commits, log in or publish anything. GitHub operations use the existing CLI environment and authenticated `gh` installation. No Graphite token is required.

## Tools and request authority

The server exposes exactly two tools:

For exact child arguments, all-children defaults and selected-scope recovery, see [targeted insertion](targeted-insertion.md).

- `learn_an`: accepts absent arguments or `{}` and returns maintained English guidance about stacks, inspection, staging, create/modify/restack, protected branches, conflict recovery and deliberate submission.
- `run_an_cmd`: executes this same Anthracite build with a literal argument array in an explicitly selected directory. It can modify repositories and contact external services, just like the direct CLI.

Every `run_an_cmd` call requires exactly these three fields:

```json
{
  "args": ["log", "short", "--stack"],
  "cwd": "/absolute/path/to/project",
  "why": "Inspect the selected stack before changing it"
}
```

`args` must be a nonempty array of strings. Individual strings are passed literally, including spaces, Unicode and shell-looking text; they are not a shell command. `cwd` must be an absolute, existing, accessible directory. Symlinks are allowed; a consumed CLI `--cwd` override must resolve to that same real directory. Non-repository directories are valid for commands such as `--version`; commands requiring Git report their normal CLI error there. `why` must contain non-whitespace text and is explanation metadata only. Extra fields, wrong types and NUL characters are refused before a child starts.

Each request keeps its own arguments and directory. The server launches its own build directly rather than looking up `an`, `ch` or `gt` on PATH. Existing command aliases, Git passthroughs, configuration, hooks and credentials retain their CLI meanings. Recursive MCP server startup through the execution tool is refused; documentation requests such as `mcp --help` remain available.

User and repository instructions, client authorization and the owner's publication approval process remain authoritative. Connection, discovery, tool annotations and `why` do not authorize staging, committing, pushing or changing pull requests. Obtain the owner's required explicit approval for publication and PR metadata before submitting. The execution tool is a general CLI interface, not a shell or filesystem sandbox, and introduces no replacement permission service.

## Results and non-interactive execution

`run_an_cmd` returns one MCP text item containing a JSON object:

```json
{
  "status": "success",
  "stdout": "main\n",
  "stderr": "",
  "exitCode": 0,
  "signal": null,
  "truncated": false
}
```

The six statuses are stable:

| Status          | Meaning                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `success`       | Normal zero exit with complete output; MCP `isError` is false.                                           |
| `cli_error`     | Nonzero CLI exit or observed termination signal.                                                         |
| `invalid_input` | Invalid tool arguments, inaccessible/contradictory cwd or recursive server startup; no CLI child starts. |
| `spawn_error`   | The wrapper could not launch the CLI.                                                                    |
| `timeout`       | The command exceeded its configured execution deadline; owned work was stopped.                          |
| `output_limit`  | Combined captured stdout/stderr exceeded the configured byte limit; owned work was stopped.              |

All six fields in the example are always present. Wrapper errors also include an actionable `message`. Exit code and signal are nullable and describe the observed process outcome; the wrapper does not invent a CLI exit code for a validation or launch error. Every status other than `success` sets MCP `isError` to true. Unknown tools/methods and malformed JSON-RPC follow the SDK's protocol error handling rather than pretending to be CLI results. An ordinary failed tool call leaves the session usable.

Stdout and stderr remain separate. Ordinary UTF-8 output preserves whitespace and trailing newlines without ANSI stripping or line-ending rewriting. Protocol stdout contains only MCP messages; server diagnostics go to stderr. Quiet and debug options cannot suppress or contaminate MCP responses. Binary output, streaming output and structured stack JSON are outside this interface.

CLI children have closed stdin and no PTY. Anthracite's non-interactive policy is forced even if interaction was explicitly requested: no prompt answers, Anthracite editor or pager are supplied. Give required choices, selectors and commit metadata explicitly. Arbitrary hooks and credential helpers keep their own behavior and are subject to execution limits; MCP does not implement a second prompt or hook system. Frozen branches and branches occupied in another worktree retain their normal protections.

## Limits, cancellation and shutdown

Each server runs at most one execution at a time, in arrival order. Discovery, learning and protocol cancellation remain responsive while work runs. Separate server instances use the CLI's existing concurrency guards.

| MCP server option      | Default                 | Accepted integer range |
| ---------------------- | ----------------------- | ---------------------- |
| `--command-timeout-ms` | `300000` (five minutes) | `1`–`3600000`          |
| `--max-output-bytes`   | `1048576` (1 MiB)       | `1024`–`16777216`      |

Put server options after `mcp`, for example `"args": ["mcp", "--command-timeout-ms", "60000"]`. Invalid settings fail before transport startup. A command's deadline begins when its child is spawned, excluding queue time. The output cap counts the combined raw stdout/stderr bytes. Overflow retains a bounded UTF-8-safe prefix and sets `truncated: true`; never treat it as complete output. The first accepted timeout/output stop reason determines its error status.

Public MCP cancellation discards queued work without starting it. Active cancellation interrupts owned work and releases its slot only after cleanup. An accepted cancelled request has no ordinary result; a result that completed before cancellation may already have arrived. Late, unknown or malformed cancellation cannot cancel a different request.

Closing client stdin, disconnecting or sending SIGINT/SIGTERM to the server stops admission, discards the queue and interrupts active work before server exit. There is no durable job, automatic retry or continued queue after disconnect. On supported macOS/Linux hosts the supervisor owns each CLI process group, tries SIGINT, allows at most two seconds before SIGKILL for remaining members, reaps its direct child and waits for cleanup. An internal watchdog stops the server if cleanup cannot be established, rather than starting another mutation.

Cleanup preserves unrelated processes and foreign locks. Adapter cache-lock removal is limited to a matching terminated CLI owner after its group has stopped; Git locks, staged resolutions and continuation data are not cleared. These guarantees cover ordinary owned descendants. They do not promise containment of deliberately detached third-party daemons, Windows process-tree supervision or certification on every platform.

## Inspect and recover after interruption

Interruption does not roll back changes. A command may already have created a branch, commit, parent update or partial Git operation. Reconnect, inspect `git status`, refs, staged changes and Anthracite's reported state before retrying. Do not infer success from cancellation or server exit.

Use `run_an_cmd` with `args: ["absorb", "--dry-run"]` (or `["ab", "-d"]`) to inspect exact destination commits, leftovers and required replay. Apply an authorized plan with `["absorb", "--force"]`; the child has closed input and cannot confirm a plan. `--all` includes tracked updates/deletions and already staged entries, never untracked files. `--patch` needs a real terminal and is refused through MCP. Unsupported entries and unmatched hunks remain staged. Frozen targets are excluded, and frozen or occupied mandatory participants refuse before changes even with force. Absorb performs no implicit fetch, push or PR operation.

An owned absorb replay conflict keeps original local input separate from the resolution index. Resolve deliberately, stage only the resolution and use `continue` in its original worktree. Continuation rechecks expected refs, protection, worktree ownership and Git environment redirection before `--all` can stage. Successful completion restores leftovers and unstaged work once. A failure without an owned active rebase instead prints reached progress and an executable guarded manual restoration path; earlier amendments survive Git abort. Preserve the reported owned input and inspect new work before recovery. The existing MCP error envelope and lifecycle rules still apply.

A normal rebase conflict returns `cli_error` and leaves recovery state in the repository. Stopping the server does not abort that rebase or erase continuation data. Resolve files deliberately using ordinary tooling, stage the intended resolutions and invoke `an continue` through a fresh MCP session if needed. Further conflicts may require another inspection/resolution cycle. Do not automatically abort, retry or bypass frozen/worktree guards. See `learn_an` and `an <command> --help` for supported workflow commands.


## Get through the existing tools

Learn with `learn_an`, then execute authorized get work through `run_an_cmd` using the same literal flags as the direct CLI:

```json
{
  "args": ["get", "target", "--downstack", "--no-restack", "--no-checkout"],
  "cwd": "/absolute/path/to/project",
  "why": "Refresh the authorized chain and retain the original checkout"
}
```

Get/g default to the required PR chain plus eligible locally tracked descendants, automatic local maintenance after all incoming updates, and final target checkout. The example explicitly limits remote selection, defers automatic maintenance and restores original checkout identity on success. Necessary maintenance can include a sibling outside downstack remote refresh; it is reported separately. Trunk advances by fast-forward only, including with feature force. Remote-only discovery, cleanup, pushes and PR writes are excluded, and sync retains its own behavior. See [the get guide](get.md) for changed defaults, import/frozen policy and the compatibility recipe.

The existing `success`/`cli_error` envelope applies. Get does not gain prompts under MCP, and local-file/worktree/frozen checks remain authoritative. An owned conflict retains actual Git state and saved source/parent/import/replay/checkout intent; resolve in the printed original worktree and invoke `continue`/`cont` in a fresh call. Mandatory protections are rechecked before `--all` stages. Raw abort, invalid ownership or ambiguous no-active-rebase publication/final-checkout failure requires inspection and preserves reached work; do not clear records or blindly retry. Finish pending owned get before downgrading.

[Candidate verification](verification/get-updates-implementation-2026-10-31.md) includes one isolated installed npm/stdio MCP workflow with actual direct-CLI Git parity and a protected failure. It does not certify live GitHub/Graphite behavior or authorize publication.

## Review and landing

Use the existing `run_an_cmd` tool with literal arguments: `["pr", "target"]`, `["review", "target"]`, and `["land", "target", "--dry-run"]` inspect without authorizing writes. A single explicit review action needs its fresh full `--head` and, for comment/request-changes, a nonempty body. Never automatically repeat an uncertain review POST. Reviewer assignment in `submit` is separate from a submitted review.

An authorized `["land", "target", "--yes"]` merges only the captured trunk-to-target chain; necessary surviving arms receive local replay and maintenance of existing heads/PRs. Unpublished work stays unpublished. Fresh readiness and explicit remote leases apply after each merge/replay. Unknown policy, missing publisher evidence, changed participants and frozen/occupied remaining work stop the run; there is no bypass, queue, auto-approval or implicit submission.

A replay conflict returns `cli_error` with completed effects retained. Reconnect, inspect and resolve/stage deliberately, then `["continue"]` performs local-only replay. It never merges, pushes or edits PRs. Explicit `["land", "original-target", "--yes"]` is required for remote resumption, including after target deletion. A proven pending queue can resume after resolving protection/hook blockers; raw abort or ambiguous ref/metadata completion instead requires manual inspection. Foreign/invalid/unproven recovery and locks remain preserved. See [scoped landing](land.md) for exact ownership and recovery limits. These adapter tests are separate from any later authorized live GitHub smoke.
