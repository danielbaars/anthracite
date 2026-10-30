# Inspect GitHub pull requests

`an pr [branch]` reads fresh GitHub information for one tracked local branch. The default is the physically checked-out branch. Numeric names remain branch names; PR numbers and URLs are not selectors. Trunk, unknown/untracked branches and uninitialized repositories are refused.

```sh
an pr
an pr feature-b --stack
an pr feature-b --web
an --cwd /path/to/repository pr feature-b --quiet --no-interactive
```

`--stack` includes the connected component beneath the same trunk child, including fanout. Independent children of trunk are excluded. `--web` opens only the selected PR's validated GitHub URL; it is the only browser request, including when combined with `--stack`.

Output identifies the configured repository, branch, PR number/URL/title/author, state and draft status, actual base, full remote head OID, review decision, checks and GitHub merge state. Missing information is explicit. An empty checks list does not establish that checks or reviews are unnecessary; policy remains unknown until separately verified. A branch without a PR is distinct from unavailable GitHub information. Missing `gh`, authentication/permission failures, rate limits, network failures, malformed responses, ambiguous matches and stale associations produce errors.

These workflows support same-repository PRs on github.com and use the configured repository explicitly. Inspection does not repair or populate associations, fetch into local refs, change the checkout/index/working files or clear caches and recovery. Explicit tracked-branch inspection works during detached recovery; an implicit selection refuses detached HEAD. Quiet retains inspection data, and noninteractive execution requires no prompt, pager or editor.
