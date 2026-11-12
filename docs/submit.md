# Pull request submission

## Reviewers and assignees

Submission selects branches independently of who receives a review request or assignment. `an submit` and `an s` select the starting branch and its ancestors. `--stack`, or `an ss` by default, also includes descendants. `--branch` changes that starting point without checking it out.

To submit a selected stack while adding roles only to the PR for `feature-b`:

```sh
an submit --stack --branch feature-b \
  --reviewers alice,example/review-team \
  --assignees @me,bob \
  --roles-branch feature-b \
  --dry-run
```

Review the preview, then repeat without `--dry-run` to execute the submission. `--roles-branch` takes an exact local branch name. It does not add or remove branches from the submission selection. An excluded, frozen or update-only-skipped explicit target fails before pushing.

Without `--roles-branch`, both supplied lists apply to every selected PR. This preserves the existing scope-wide meaning of `--reviewers`. Existing roles are retained; the options add people rather than replacing lists. A reviewer is asked to assess changes; an assignee is responsible for progressing the PR.

Reviewers accept comma-separated usernames or `organization/team` names. In a terminal, bare `--reviewers` asks for reviewers per target PR; with `--roles-branch` it asks only for that PR. A dry-run identifies an unresolved reviewer choice without prompting. Supply explicit names when executing through an agent or another noninteractive client.

Assignees accept comma-separated usernames and `@me`, which resolves to the authenticated GitHub account. An empty assignee argument is an error. Already present assignees and pending review requests are retained without redundant additions. Explicitly requesting a reviewer after a completed review starts another review round.

Role options preserve draft status. Use the existing `--publish` or `--draft` options deliberately when a status change is intended. GitHub eligibility and permission failures are reported rather than worked around by publishing.

Submission stops at its first failure. Already pushed code, PR changes and confirmed role additions remain applied. Read the reported confirmed, failed and unattempted work before repeating; submission does not roll back reached work or store deferred role changes. Use `gh pr edit` for separate edits or removal of reviewers and assignees.

The same literal arguments work through the existing MCP `run_an_cmd` tool. MCP execution is noninteractive and retains the owner's publication approval process; see [MCP configuration and authority](mcp.md).

## Reusing branch names

The candidate fix for [#139](https://github.com/danielbaars/anthracite/issues/139) distinguishes the current open PR from historical closed or merged PRs. Submit updates a unique verified open PR even when local commits have not yet been pushed. If complete discovery finds no open PR, submit uses normal new-PR inputs and defaults; `--publish` creates it ready for review, while unattended submission otherwise creates a draft. Historical titles, descriptions, roles, draft status and dependency footers are not edited.

Previews identify creation versus updates. Ambiguous, incomplete or unavailable identity evidence refuses before the first push, and confirmed plans are checked again before execution. If a PR closes or changes identity after code has already been pushed, submission stops and reports that reached work. Inspect the current PRs before retrying; an uncertain creation response is reconciled through discovery rather than blindly creating another PR.

## GitHub visibility after pushing

In the source candidate for [#149](https://github.com/danielbaars/anthracite/issues/149), discovery validates repository, number and branch identity independently of mutable head/status snapshots. A stale list snapshot can trigger a fresh detail read instead of reporting a concurrent identity change. Known-number review and landing inspection retain their pinned identities.

After updating an existing PR branch, submit confirms both the actual remote head and GitHub's detail head against the commit it pushed. If the detail snapshot returned by discovery is still behind, it allows up to two additional known-number detail reads, with 250 ms before each. These retries repeat reads only; they do not repeat pushes or PR writes. Once confirmed, normal PR and dependency-footer work continues in the same command.

If visibility stays unconfirmed, the error identifies the already-pushed code and unattempted work. Repeat submit with the same selection after visibility recovers; existing footer reconciliation needs no new commit. A changed or unavailable remote head, closed PR, invalid identity or ambiguous association still refuses. Public npm 0.6.13 predates this correction.

Dependency-footers use current verified PR identities, including editable referenced ancestors and descendants outside the push selection. A retired out-of-scope association cannot authorize a PR edit or silently expand submission: resolve that stale branch relationship, then preview again. Frozen anchors retain their existing protection and are neither refreshed nor edited by submission.

## Explicit PR titles

Use `an submit --title "Approved PR title" --no-interactive` to set the title
of the starting branch's PR. `--branch` chooses that starting branch; the option
does not apply one title to every PR in the submission scope. It works during
creation and without new commits on an existing PR. Other selected branches
keep their titles, and existing descriptions are read from GitHub and preserved.

Titles must be nonblank and single-line. `--dry-run` reports the target and title
without publication. Explicit titles bypass that PR's field prompts and work with
`--no-edit`; combining them with `--edit` is rejected. Frozen or skipped targets
and disabled GitHub integration refuse before any pushes or PR writes. Existing
push verification, roles, draft options and dependency-footer handling still apply.
