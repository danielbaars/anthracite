# Review a pull request

`an review [branch]` displays the actual selected GitHub PR base-to-head diff and both full commit OIDs. The optional branch is a literal tracked local branch, as with `an pr`; a numeric name remains a branch name. The default uses the physical checkout. Detached recovery requires an explicit branch. A changing PR identity, base or head stops inspection before the diff is printed.

Submit exactly one review with one explicit action and the full expected head:

```sh
an review topic --approve --head <full-oid>
an review topic --request-changes --head <full-oid> --body-file feedback.md
an review topic --comment --head <full-oid> --body 'Please clarify this case.'
```

`--request-changes` and `--comment` require non-whitespace text. Approval may omit its body. Supply one literal `--body` or UTF-8 `--body-file`; using both, unreadable or invalid UTF-8 files, stdin (`-`), and head/body options without an action are errors. Text, Markdown and newlines are preserved without a shell, editor or pager.

An action submits one review as the authenticated GitHub CLI user for the specified commit. It does not request reviewers or assign anyone; `an submit --reviewers` requests a review instead. GitHub's self-review, permission and eligibility restrictions still apply. The returned review and its independent readback must match the PR, authenticated author, event, exact body and commit before the current PR snapshot is checked again.

An accepted review for an older head is retained and returns failure. A missing, malformed, mismatching or lost response is unverified or uncertain progress. Anthracite never automatically retries a review POST, dismisses it or replaces it. Inspect the reported PR/review URL and the supplied read-only `gh api .../reviews` command before deliberately submitting another review.

Inspection and actions preserve local branches, refs, index, working files, associations, caches and recovery data. Only an explicit action changes GitHub. Quiet and noninteractive execution keep essential results/errors visible and do not launch a browser, prompt, editor or pager. This contract supports same-repository PRs on github.com through the configured repository identity.
