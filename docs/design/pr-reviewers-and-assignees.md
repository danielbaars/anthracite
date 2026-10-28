# Per-PR reviewers and assignees

Status: design and verification boundary agreed on 2026-10-28. Implementation specification not yet written.

## Goal

Assign reviewers and assignees to the intended individual pull request during Anthracite submission, including noninteractive agent workflows. Submitting a stack must not require applying the same people to every PR.

## Confirmed decisions

- Make per-PR targeting within `submit` the primary feature. A stack can be submitted while reviewer requests and assignments target only the intended PR; other submitted PRs retain their existing roles.
- Leave standalone editing of existing PRs to `gh` for the initial delivery. The standalone Anthracite operation discussed in the first interview round is superseded by this narrower integration goal.
- Preserve existing roles. Removal, whole-list replacement and clearing all assignments are outside the initial submit integration.
- Review requests and assignments are distinct roles, as defined in [the glossary](../../GLOSSARY.md).
- One invocation uses one shared target PR for its supplied reviewers and assignees. Per-PR lists across multiple targets are outside the initial scope; separate invocations can target different PRs.
- Preserve existing scope-wide `submit --reviewers` behavior. An explicit new targeting option will narrow role additions without narrowing the submitted branch set.
- Initial delivery adds reviewers and assignees only. Named removals remain available through `gh`.
- Preserve successful submissions and role additions if later additions fail. Report successful and unsuccessful changes explicitly and return a failure status; do not automatically roll back.
- Repeating an invocation must preserve existing assignees and pending review requests without redundant role additions. An explicit request may request review again after a completed review, as described below.

## Current behavior verified in source

- `submit --reviewers alice,bob` applies one list to every selected submission branch. Default scope includes ancestors and the current branch; `--stack` adds descendants.
- Interactive `--select` can narrow submission, but is ignored without interaction. `--branch` changes the starting branch rather than limiting scope to one PR.
- Bare `--reviewers` prompts per prepared branch; an explicit list is shared across selected PRs.
- Existing reviewer updates are additive. They run through submission, which pushes selected branches and can update dependency footers.
- Reviewer confirmation supports users and teams. Assignee management and reviewer removal are absent.
- Frozen branches are excluded from submission, including submit-time reviewer changes.

Source references: [submit options](../../apps/cli/src/commands/submit.ts), [submission workflow](../../apps/cli/src/actions/submit/submit_action.ts), [branch preparation](../../apps/cli/src/actions/submit/prepare_branches.ts), [reviewer updates](../../apps/cli/src/actions/submit/request_reviewers.ts), [public reviewer tests](../../apps/cli/test/commands/submit_reviewers.test.ts).

## Approved interface and boundaries

```sh
an submit --stack --reviewers alice,bob --assignees @me --roles-branch feature-b
```

- `--roles-branch <branch>` selects the one shared PR target for role additions without changing the submission scope. It takes an exact local branch name, not a PR number or URL.
- Without `--roles-branch`, both supplied lists apply to all selected submission PRs. Existing reviewer invocations retain their scope.
- `--branch` retains its existing role as the starting branch for submission.
- Reject an explicitly targeted branch that is outside the final submission selection, frozen, or skipped by `--update-only`. Report the problem before any branch push; do not expand scope or silently omit role changes.
- Accept comma-separated user and `organization/team` reviewer names. Accept comma-separated user assignees and `@me` for the authenticated user.
- Treat duplicate recipients as one addition. Empty assignee input is an error; preserve existing interactive reviewer selection.
- Role additions do not implicitly publish drafts. Existing explicit `--draft` / `--publish` semantics remain authoritative.
- Report GitHub refusals as failures without storing deferred role-change instructions.

## Repeated requests and failures

- Preserve an existing pending review request without reissuing it. A completed historical review does not count as a pending request: explicitly supplying that reviewer requests review again.
- Preserve an existing assignee without adding them again.
- Stop submission at the first failure, including a failed role change. Do not proceed to remaining submission work.
- Preserve reached work. Report which changes are confirmed, which failed, and which were not attempted, returning a failure status. Do not report unverified remote changes as confirmed successes.
- Do not automatically roll back pushed branches, created or updated PRs, or successful role additions.

## Visibility and approved verification boundary

- Dry-run output identifies both the submitted PR set and the reviewers and assignees intended for each PR.
- Public CLI tests use real local Git stacks with a controlled GitHub substitute that records calls and supplies responses.
- Cover target selection, preservation of existing roles, teams, `@me`, drafts, invalid input, partial success and safe repetition.
- Check that non-target PRs retain their reviewers and assignees, and that existing submit workflows retain their behavior.
- Run targeted checks against Node and the native binary, with one MCP execution check.
- Keep the full CI matrix disabled. Live GitHub review requests are not required for this verification boundary.

## Scope exclusions

- A standalone Anthracite PR-editing command; use `gh` instead.
- Role removal, replacement, or clearing.
- Different recipient lists for multiple target PRs in a single invocation.
- Hidden deferred role changes or automatic publication to accommodate a role request.

## Interview outcome

All proposed behavior and the verification boundary have been approved. No product-design questions remain open in this interview. The next artifact can turn these decisions into an implementation specification without reopening the agreed scope.

## Publication

The design is recorded locally. No implementation or GitHub publication has been requested for this design.
