# Landing required versus optional checks

## Change and baseline

Baseline: main `c1ee9a4d1d69f67f3b1cde2568ff96d8fad9928a`, published npm 0.6.15. This is an unreleased source candidate; its isolated test package still carries the baseline version and is not an npm publication.

Previously, landing treated every check run and commit status as mandatory and separately required GitHub's aggregate `CLEAN` state. The first new public-process regression failed with both `GitHub readiness is UNSTABLE` and `Check publish-beta: FAILURE`, despite verified policy requiring no checks.

The shared readiness evaluation now gates only the checks named by freshly verified classic protection and applicable rulesets. Optional nonpassing checks produce explicit nonblocking warnings. `UNSTABLE` is accepted only alongside existing mergeability, reviews, identity, policy and required-check guards. Unknown or unexplained `BLOCKED`, conflicting, behind and unavailable readiness remain blocking; a concrete pending required check can still enter bounded waiting. Unavailable check results block required checks, but do not invent a check requirement when policy explicitly requires none.

The same adapter is used by fresh inspection, saved inspection and execution/waiting. Required publisher provenance, exact heads, local and remote leases, merge selection, confirmation, cleanup and recovery ownership are unchanged. No flags, ignore list, workflow-name exemptions, administrative bypass or stored-format migration are added. Ordinary CI adds three representative CLI cases to its existing single Linux job; triggers, job timeout and the manual-only full matrix remain unchanged. Help, the landing guide and MCP learning describe the changed policy.

GitHub defines `UNSTABLE` as mergeable with nonpassing commit status and lets repository owners select required checks: [merge status reference](https://docs.github.com/en/graphql/reference/pulls#mergestatestatus), [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).

## Public-process acceptance

Tests use real disposable Git repositories and bare remotes, controlling only the external gh boundary. The new cases cover optional running/failed check runs and commit statuses, preservation on preview, unavailable check results with/without requirements, required pending/failed/missing/successful checks mixed with optional failure, conservative aggregate states, optional checks triggered by mandatory pushes and saved resumption without repeating confirmed merges.

Existing waiting tests now explicitly declare their checks required and supply successful results when clearing them. Private-plan recovery tests create a pause under normal required-check policy before switching to independently verified policy absence; absence of enforcement can no longer legitimately be used to wait for an optional check. Existing policy, protection, publisher, conflict and continuation controls remain part of targeted acceptance.

A separate [compatibility probe](evidence/land-required-checks-2026-11-09/legacy-resume.cjs) creates an actual saved version-1 landing with the unchanged public npm 0.6.15 executable, then previews and resumes it with the candidate while optional publication is failed. The [retained result](evidence/land-required-checks-2026-11-09/legacy-resume.json) confirms byte-preserving preview and exactly two total merge requests for the two-PR chain, with no repeated first merge. Reproduce using Node with arguments: absolute candidate checkout, absolute public 0.6.15 executable, output JSON path; set ANTHRACITE_TEST_BINARY to the candidate executable.

Final focused acceptance is **21/21 on Node, 21/21 on native and 4/4 on the isolated installed npm candidate**. Combining these reruns with the broader campaign gives **151 passing cases and two baseline failures per runtime**, rather than an entirely green broader suite. Typecheck, targeted source/new-test lint, formatting and actionlint pass.

Final measured counts and artifact identities are recorded in the [validation receipt](evidence/land-required-checks-2026-11-09/validation.json).

## Existing broader failures

Two broader review regressions fail on both candidate runtimes and also on the unchanged public npm 0.6.15 binary, with the same assertions: the foreign-continuation hook case expects an unmerged index but finds none, and a saved inspection after original-target deletion fails resolving its removed local ref. The [baseline comparison](evidence/land-required-checks-2026-11-09/existing-regressions.json) retains the results. These remain outside the requested check-selection fix; the broader campaign is not reported as entirely green.

The initial resumed-display regression also exposed an outdated optional-check fixture and warning placement before blockers. The fixture now declares its check required, warnings follow the blocker-first plan, and final reruns cover both fresh and saved presentation. A dedicated new dirty-worktree/optional-failure case prevents a return to warning-first output.

## Validation limits

The source change, new regression file and modified fixture pass targeted lint and formatting; typecheck passes. Broader lint on the modified pre-existing test files still reports four oversized suite callbacks and two unused destructured lock variables. All six diagnostics were independently reproduced from the unmodified main versions; this change does not claim to clean up that pre-existing test lint.

No live GitHub merge/publication, frontend-packages edit, user installation change, new CI job or Actions dispatch is part of this implementation. No full CI matrix is run. Controlled fixtures demonstrate local delivery and guards, not live GitHub acceptance for the user's pending landing. Actual optional workflow execution and its Actions cost are unchanged; only landing's waiting/blocking decision changes.
