# PR review and stack landing — specification basis

Date: **30 October 2026**. Status: **approved scope; specification only; not implemented or runtime accepted**.

## Baseline and decision

The inspected repository baseline is [a070dd5ce4890a37a4e6506bb2b2fd50752c5379](https://github.com/danielbaars/anthracite/commit/a070dd5ce4890a37a4e6506bb2b2fd50752c5379), the documentation reconciliation above released Anthracite 0.4.0. The release source is [9c173deb652509ca55ba9104b1254705b439d396](https://github.com/danielbaars/anthracite/commit/9c173deb652509ca55ba9104b1254705b439d396). This record is source/design evidence, not a new execution comparison against Graphite or a test of the proposed commands.

The owner approved PR inspection and explicit single-PR review plus prefix landing through direct GitHub rebase merges, preserving raw Git merge. They approved one primary acceptance seam: the actual CLI, real temporary Git repositories/bare remotes, and only gh controlled. Existing MCP execution supplies a small additional public-route check. No full matrix is authorized.

The [specification](../specs/pr-review-stack-landing.md) adds concrete command flags, distinct merge/maintenance scopes, head-bound review, per-merge readiness checks and minimal retained recovery. These are Anthracite design decisions. The feature remains G01; the old log backlog remains deferred.

## Source observations and existing seams

These files were read, not run as new acceptance tests:

| Observation | Pinned source |
| --- | --- |
| Explicit command registration has no dedicated pr, review or land route. | [Command modules](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/command_modules.ts) |
| merge is on the raw Git allowlist; replacing it would change existing meaning. | [Passthrough](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/lib/pre-yargs/passthrough.ts) |
| Existing GitHub scoping explicitly uses configured owner/repository rather than gh's inferred fork remote. New writes also need fresh complete PR identity and head checks. | [Repository scope](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/lib/api/github_repo.ts), [PR discovery](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/lib/api/pr_info.ts) |
| The runner already has a preserving inspection route; ordinary mutation setup is inappropriate for a strict read-only preview. | [Runner](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/lib/runner.ts) |
| Existing scopes distinguish branch/downstack/upstack/stack. A landing chain must not inherit whole-stack cleanup defaults. | [Scope definitions](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/lib/engine/scope_spec.ts) |
| Ordinary sync inspects all tracked PRs, considers broad cleanup, and can offer a trunk reset. Those defaults do not satisfy the narrow landing contract. Scoped engine/replay primitives can be reused without calling broad sync. | [Sync](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/actions/sync/sync.ts), [cleanup](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/src/actions/sync/clean_branches.ts) |
| CLI fixture already owns isolated HOME, real repo, bare remote and external gh state; only the gh executable is replaced. Extend this boundary, not Git itself. | [Submit fixture](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/test/lib/fixtures/submit_cli.ts), [external gh fixture](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/test/lib/fixtures/submit_gh.ts) |
| Public tests already distinguish partial external writes from confirmed progress and allow deterministic changes between requests. | [Role-progress tests](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/test/commands/submit_roles_progress_cli.test.ts) |
| A real stdio client already verifies stack changes through run_an_cmd and independent Git observations. | [MCP workflow tests](https://github.com/danielbaars/anthracite/blob/a070dd5ce4890a37a4e6506bb2b2fd50752c5379/apps/cli/test/commands/mcp_workflows_cli.test.ts) |

## Graphite reference limit

The historical [comparison](https://github.com/danielbaars/dinky-misc/blob/9ddc0155f4bcfba548dc6dc82dde9398994fe2b1/research/graphite-charcoal-feature-parity-2026-10-21.md) retains Graphite **1.8.6** help for pr, review and merge. The records were reread locally for this specification. They advertise opening a branch/PR page, experimental current-branch review and merging trunk-to-current PRs via Graphite, with a merge dry-run. They do not prove runtime success, protection behavior, review-body semantics, recovery or account-independent operation. No Graphite review or merge was executed to prepare this specification. The new land spelling is an intentional compatibility choice, not a measured Graphite alias.

## Primary GitHub interface constraints

Official documentation was checked on 30 October 2026:

- GitHub's [review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request) accepts an explicit commit_id and review event. The spec uses that facility to identify the reviewed revision and requires truthful confirmation; it does not promise an atomic condition on a head that changes concurrently.
- GitHub's [direct merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) offers a head SHA condition and a rebase method. The spec requires direct confirmed merges and fresh policy checks, without promising a transaction over an entire stack.
- The [gh pr merge manual](https://cli.github.com/manual/gh_pr_merge) describes automatic merge/queue behavior for queue-required branches. Consequently, blindly wrapping gh pr merge is insufficient for the accepted no-auto/no-queue contract; the implementation must use direct semantics and refuse unsupported queue policy.

These documents establish interface constraints. They do not prove the caller's organization permissions, every branch-ruleset combination, or live service behavior. A later implementation must retain unknown-state refusals and a bounded live smoke with its own authorization.

## Verification and publication limits

For this delivery, validate the specification sections, story numbering, test groups, internal links/anchors, source-reference existence and documentation-only diff. Commit and push the documentation before linking the exact remote files from the issue. Use skip-CI protection. No production code, workflows, installation, credentials or branch protection are changed; no live PRs/reviews/merges, test suite, CI or full matrix is part of specification preparation.

The retained local validation receipt records actual checks; the future acceptance groups in the specification are requirements, not executed passing tests. No percentage of Graphite parity is inferred from this design record.
