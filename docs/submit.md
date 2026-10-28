# Reviewers and assignees during submission

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
