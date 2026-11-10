# #167 — Deferred landing plans and readiness

## Commits and integration

- Implementation: `7969dd4bd79da95a3d98d642397e477f51773805` (`fix(cli): disclose deferred landing readiness`).
- Worktree: `/private/tmp/anthracite-167-20261110`, branch `implement-deferred-land-plans`.
- Confirmed clean integration base before edits: `7cff723d5f6a2c9acd9c740f890563c47ed1d22a`.
- Merged latest integration `76ad170eb5d52217632fcfab659e3f72ee00608a` before handoff. Resulting tip: `3080e39d9a8eba7b4a8b7bbfc2cd95fc1b2b3628`. This merge was documentation/evidence only. Working tree clean.

## Behavior and interfaces

- Fresh plans name later PRs whose publication is deferred until their own merge preparation. Readiness is explicitly limited to the next merge, including debug output.
- Saved plans distinguish immediate local replay from deferred push and PR base/footer reconciliation; debug diagnostics disclose the same intent alongside existing OIDs.
- `inspectPendingReadiness` retains the existing exact PR/remote/local identity checks before deliberate deferral. Only obsolete-head readiness is deferred. A draft, changes-requested review or missing approval still blocks.
- New shared internal API `githubLandReviewBlockers(pr, policy): string[]` extracts the existing state/draft/review checks without changing their behavior or order inside `githubLandReadiness`. The deferred path calls the same review rules; due/current targets still use full readiness, policy, exact head/base and publisher verification.
- No scheduler, stored-format or execution-authority changes in this slice. #168 retains publication/failure/retry ownership. No new CLI option, dependency, external test seam or workflow change.

## TDD and verification

- Initial public-process red run: all three initial regressions failed as expected (fresh per-target labels/global readiness; saved deferred maintenance wording; missing deferred draft blocker). No passing implementation assumption was used as the red signal.
- `land_deferred_plans_cli.test.ts`: seven cases passed on Node 24.19.0 and native Bun 1.3.14, approximately three minutes per runtime. They cover fresh and saved dry-run/decline equality and opaque local/recovery preservation; three independent deferred review blockers; required next-head failure versus deferred old-head failure; fresh changed policy; optional failed/pending checks completing without waiting or repeating merges.
- After final debug wording and assertions, reran the saved preserving/debug case plus the existing exact-head app-bound required-check wait/publisher regression on both runtimes: **2/2 passed per runtime**. Durable receipts: `167-final-node.json` and `167-final-native.json` in this context directory.
- Full TypeScript build/typecheck passes. ESLint passes for `land.ts`, `land_scoped.ts`, `github_land_policy.ts` and the new test. Prettier applied to those files.
- The new tests use public CLI processes, real temporary Git/bare remotes and existing controlled `gh` boundary. The seven-target push/count acceptance is already exercised by #166's real-hook tests and was not redundantly rerun here. #169 owns installed npm/MCP delivery acceptance.

## Limits

No live GitHub writes, pushes, PR/issue changes, CI/full matrix, workflow edits, user-project changes or active-installation changes were performed. Existing known baseline recovery failures remain outside this slice. The seven-case full runs used dot output; only the final two-case reruns have JSON receipts retained by this child.
