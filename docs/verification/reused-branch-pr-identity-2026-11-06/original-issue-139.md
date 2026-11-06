## Problem

A branch that reuses the name of a closed or merged PR is adopted by that PR. Anthracite resolves a branch to a pull request by head name and never looks at the PR's state, so a name that was used before comes back with a dead PR attached — and `submit` then tries to edit it.

The branch name is not a durable identifier: GitHub deletes the head branch on merge, and names like `resolve-audit-findings` or `update-dependencies` are meant to be used again. The fix for this today is to put a date in the branch name, which only works as long as you remember.

## Reproduction

`resolve-audit-findings` had been merged three days earlier as #890, its branch deleted on merge. A new branch with the same name, inserted under a stack, was submitted:

```
$ an submit --stack --no-interactive --roles-branch resolve-audit-findings --assignees @me
 * [new branch]          resolve-audit-findings -> resolve-audit-findings
X Pull request NVWA-KBC/beheer-beslisboom#890 is closed. Only draft pull requests can be marked as "ready for review"
ERROR: Failed to submit PR for resolve-audit-findings: Command failed: gh pr ready 890 --repo NVWA-KBC/beheer-beslisboom --undo

Code for resolve-audit-findings was already pushed; earlier confirmed PR changes remain applied.
Not attempted: submission of storybook-overview-examples; dependency footer updates.
```

The branch was pushed and the stack was left half-submitted. `an pr` showed the same association.

The lookup underneath, on a branch that has no open PR:

```
$ gh pr view resolve-audit-findings --repo NVWA-KBC/beheer-beslisboom --json number,state
{"number":890,"state":"MERGED"}
```

`gh pr view <branch>` does not search for an open PR; it searches for a PR with that head and falls back to a closed or merged one. That is `gh` behaviour, and the branch had existed for five minutes.

## Cause

Two places resolve a branch to a PR without considering state.

`apps/cli/src/actions/submit/submit_prs.ts`, in `submitPrToGithub`: the lookup requests `headRefName,url,number,baseRefName,body,isDraft` — no `state`. The create branch is only taken when the error text contains `no pull requests found`, so any answer at all counts as an existing PR to update. The guard below it cannot catch this:

```ts
if (prInfo.headRefName !== request.head) {
  throw Error(`PR head mismatch: ${prInfo.headRefName} !== ${request.head}`);
}
```

The names are identical — that is the whole problem. Execution reaches `gh pr edit --base` and `gh pr ready <n> --undo` on a merged PR.

`apps/cli/src/lib/api/github_pr.ts`: with no stored PR number, discovery runs

```
gh pr list --head <branch> --state all --limit 100
```

and adopts the single match whatever its state. This is what writes the association that `an pr` then reports.

`apps/cli/src/actions/sync/remote_update_graph.ts` already uses `--state open --limit 2` for its own lookup, so the codebase disagrees with itself about this.

## Suggested behaviour

Switching discovery to `--state open` wholesale would be wrong: `sync` needs to recognise a merged PR to clean up a landed branch. The missing discriminator is the commit, not the state alone.

- In `github_pr.ts`, accept a non-open PR as this branch's PR only when `headRefOid` matches the local branch's revision. A new branch reusing the name sits on a different commit and is then correctly treated as having no PR. Both `state` and `headRefOid` are already in `PR_FIELDS`, so this needs no extra request. Worth deciding whether equality or ancestry is the right test, and whether the existing `Ambiguous pull request association` error still behaves when a name is reused twice.
- In `submit_prs.ts`, add `state` to the requested fields and treat anything that is not `OPEN` as no PR, so the create path runs. A merged PR with the same head does not prevent `gh pr create`.

Worth checking in the same pass: `apps/cli/src/actions/sync/clean_branches.ts` matches `entry.headRefName === branchName` against `refresh.prs` in `projectCleanupBranches`. If merged PRs reach that list, `sync` could treat a fresh branch with a reused name as landed and offer it for deletion — the same mistake, in a place that deletes rather than fails. Not verified here.

## Verification

- A branch whose name matches a merged PR, with no open PR of its own: `an submit` creates a new PR instead of editing the old one.
- The same for a closed-unmerged PR.
- A branch with a genuinely open PR is still updated, not duplicated.
- A landed branch whose merged PR is at that branch's own head is still recognised by `sync` cleanup.
- Reusing a name a second time (two merged PRs with the same head) does not raise `Ambiguous pull request association`.

## Workaround used

Renamed the branch with `an rename` and submitted again. The branch pushed by the failed attempt stayed behind on the remote and had to be deleted by hand.

## Environment

- anthracite 0.6.11
- gh 2.102.0, node v24.22.2, macOS 27.2 arm64
