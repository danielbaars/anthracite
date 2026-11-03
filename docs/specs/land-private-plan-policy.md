# Support independently verified landing policy when the rules API is plan-restricted

Status: approved scope and test boundary; specification only. Baseline: Anthracite 0.6.6. This document does not claim the proposed behavior has been implemented or accepted at runtime.

## Problem Statement

A developer with administrator access to a private repository runs `land --dry-run` and receives an authentication-or-permission error while Anthracite reads applicable branch rules. Authentication actually works: GitHub denies that endpoint because the current subscription does not enable the feature. Anthracite loses that distinction and cannot complete its policy inspection.

The observed branch reports `protected: false`. An independent, administrator-visible GraphQL response reports no classic branch protection and one explicitly disabled ruleset. Merely ignoring the REST failure or trusting the branch flag would also admit genuine access failures and potentially hidden rules. Requiring a completely empty ruleset list would unnecessarily reject the observed disabled-rule case.

## Solution

Recognize the specific structured subscription-related refusal at the applicable-rules endpoint. For that case only, independently verify the configured private repository, administrator visibility, exact trunk, explicit absence of classic protection and complete repository/inherited ruleset inventory. Accept an empty inventory or an inventory containing only explicitly disabled rulesets as proof that no enforced branch protection was discovered through this bounded route.

Use the resulting policy through the normal landing workflow. Policy evidence does not establish PR readiness or grant merge permission: fresh PR identities, leases, reviews, checks, mergeability, local state and existing confirmation remain authoritative. If any required evidence is missing, contradictory, unsupported or unavailable, stop with a useful explanation and preserve reached work.

Normal REST-backed policy handling remains the preferred path. The new route neither changes repository settings nor asks users to upgrade or make a repository public as a prerequisite for this verified case.

## User Stories

1. As a private-repository developer, I want valid GitHub authentication distinguished from a subscription restriction, so that I do not repeatedly log in without resolving the problem.
2. As a repository administrator, I want landing inspection to use independently available policy evidence, so that an unavailable REST feature does not unnecessarily block a demonstrably unprotected branch.
3. As a developer, I want an explicitly disabled ruleset recognized as disabled, so that an existing inactive configuration does not prevent this workflow.
4. As a developer, I want an empty complete ruleset inventory accepted, so that repositories without configured rules receive the same verified treatment.
5. As a repository owner, I want only the specific applicable-rules subscription refusal to enable the alternate inspection, so that other API failures cannot silently relax protection.
6. As a repository owner, I want generic 401, 403 and 404 responses to remain blocking, so that inaccessible policy is never mistaken for absent policy.
7. As a developer, I want repository identity checked independently, so that evidence from another repository cannot authorize this landing.
8. As a developer, I want the configured trunk checked exactly, so that a similarly named or different branch cannot supply protection evidence.
9. As a repository owner, I want verified private visibility and administrator access, so that incomplete policy visibility is not treated as authoritative.
10. As a repository owner, I want classic protection explicitly absent, so that a missing or present classic-rule field cannot be mistaken for null protection.
11. As a repository owner, I want inherited rulesets included, so that repository-local absence cannot hide higher-level policy.
12. As a repository owner, I want every inventory page accounted for, so that a disabled first page cannot hide a later active ruleset.
13. As a repository owner, I want missing pages, repeated cursors and inconsistent counts to stop inspection, so that truncation does not appear to be a complete inventory.
14. As a repository owner, I want null, malformed and partial GraphQL results refused, so that an API response error does not become an empty policy.
15. As a repository owner, I want any active ruleset to block this narrow alternate route, so that unsupported rule evaluation cannot drop requirements.
16. As a maintainer, I want evaluate-mode and unknown enforcement states refused by this limited proof contract, so that extending supported policy requires an explicit decision.
17. As a developer, I want policy verification reported separately from PR readiness, so that proving absent protection does not label a conflicted or failing PR ready.
18. As a developer, I want an English explanation of subscription restriction and evidence failure, so that I can distinguish retryable access problems from unsupported policy.
19. As a developer, I want dry-run to inspect policy without waiting or changing state, so that investigating the problem remains safe.
20. As a developer, I want ordinary landing to show the same freshly inspected plan before confirmation, so that dry-run and application do not disagree about current policy.
21. As a developer, I want confirmed execution to repeat policy inspection at its existing guard points, so that an earlier successful preview is not a lasting exemption.
22. As a developer, I want a saved landing to obtain fresh evidence again, so that a prior subscription restriction cannot exempt resumption from policy checks.
23. As a developer, I want a ruleset activated during waiting to stop the next merge, so that check waiting does not reuse stale absence evidence.
24. As a developer, I want an approval or check failure to remain blocking after policy verification succeeds, so that this repair changes no readiness requirement.
25. As a developer, I want identity and lease changes to remain blocking, so that policy availability cannot authorize overwriting concurrent work.
26. As a developer, I want denied preflight to preserve local files, staging, refs and recovery, so that an inspection failure causes no repository damage.
27. As a developer, I want a later policy refusal to retain confirmed earlier merges and completed maintenance, so that resumption reports the reached state accurately.
28. As a developer, I want ordinary successor maintenance and landed-only cleanup preserved, so that a successful alternate inspection does not change landing scope.
29. As a developer, I want existing running-check waiting preserved, so that this repair does not reintroduce immediate pauses after Anthracite's own pushes.
30. As an agent user, I want noninteractive execution and the existing MCP route to expose the same result, so that no new tool or bypass flag is required.
31. As a maintainer, I want ordinary REST rules, classic protection and ruleset-only protection to retain their existing contracts, so that fixing this private-repository case does not regress protected repositories.
32. As a maintainer, I want the repair tested through real CLI processes and Git repositories, so that internal policy helpers do not certify their own behavior.
33. As a maintainer, I want released-package coverage as well as source/native checks, so that the installed CLI can perform the same alternate inspection.
34. As a repository owner, I want no visibility, billing, token-scope or rule changes made automatically, so that inspecting policy changes no account or repository configuration.
35. As a maintainer, I want source observations, live read-only evidence and future acceptance results clearly distinguished, so that the specification does not claim implementation success.
36. As a maintainer, I want specification publication and implementation acceptance to avoid CI and the full matrix, so that the approved local test boundary controls cost.

## Implementation Decisions

1. **Bounded capability.** Extend the existing landing policy reader for same-repository github.com workflows. Introduce no new command, flag, merge method, permission exemption or persistent setting. Do not use account-plan names, subscription guesses or repository visibility alone as policy evidence.

2. **Exact entry condition.** Only a failed first-page GET to the configured trunk's applicable-rules endpoint may enter this route. Require the observed structured JSON subscription message, body status `403`, its canonical GitHub documentation URL for getting branch rules, and a matching gh HTTP 403 failure. The recognized message is “Upgrade to GitHub Pro or make this repository public to enable this feature.” A prose fragment, generic status, different endpoint, malformed body, contradictory process result or later pagination failure is insufficient. Do not reinterpret this error globally in unrelated GitHub operations.

3. **REST prerequisites.** The normal repository read must establish the exact configured full name, private visibility, administrator access and the existing merge-method information. The branch read must identify the exact trunk and report `protected: false`. Missing access/visibility fields, a public repository or `protected: true` refuse the alternate route; no later evidence may silently override these contradictions. Existing rebase-disabled and other repository-level blockers remain effective.

4. **Independent evidence.** Make a separate read-only GraphQL query bound to the configured owner/repository and exact qualified trunk ref. Require matching `nameWithOwner`, `isPrivate: true`, `viewerPermission: ADMIN`, the exact ref name and an explicitly null `branchProtectionRule`. Omission, null repository/ref, a present protection rule, non-admin visibility or any response error is not evidence of absence. Apply schema validation before interpreting fields. Administrator visibility is a proof prerequisite, never merge-bypass authority.

5. **Complete inherited inventory.** Explicitly request `rulesets` with `includeParents: true`, with no target or enforcement filter. Read every page. Require a nonnegative stable `totalCount`, non-null nodes with unique nonempty IDs and explicit enforcement values, and valid pagination metadata. Advance only with a new usable cursor and evidence of progress. Stop with preserving refusal on inconsistent counts, duplicates, omitted/null nodes, missing pages, cursor cycles, transport/GraphQL errors or the finite internal pagination limit. Completion requires a final page and a unique fetched count equal to the declared total. A full page, a zero count on its own, or a repository-local-only inventory never establishes completeness.

6. **Accepted proof set.** Accept exactly a complete empty inventory or a complete inventory whose every node reports `DISABLED`. Any `ACTIVE`, `EVALUATE`, unknown or missing enforcement value refuses this alternate route. Inspect the whole unfiltered inventory; do not implement branch-pattern matching or dismiss a non-disabled rule because its target appears unrelated. Evaluate mode is documented as non-enforcing, but is deliberately outside this approved minimal proof set; do not falsely describe it as active enforcement.

7. **Policy result.** Successful evidence supplies absence of classic protection and enforced rules for this bounded read. Feed that result into the ordinary policy/readiness pipeline with no additional required reviews, checks or publishers inferred from the disabled rules. Do not clear independent repository-level blockers or bypass any known failing/pending PR check, approval, mergeability, identity or lease requirement. If the standard REST route becomes available, use its full policy handling instead.

8. **Failure behavior and diagnostics.** Distinguish recognized plan unavailability from authentication/permission failures and from unsuccessful independent verification. Explain the missing or contradictory evidence without printing credentials, private response bodies or account details. Do not instruct the user to log in again when the verified cause is a plan restriction. Do not automatically recommend or perform an upgrade, visibility change, token refresh or rule modification.

9. **Presentation.** Disclose that policy was independently verified despite plan-restricted REST access, without labelling that fact alone as readiness. Continue to use the shared compact fresh/saved plan presentation, with relevant blockers first and technical evidence details under existing debug output. For equivalent fresh inputs, resumed ordinary application and resumed dry-run must show the same inspected plan before confirmation. An empty review/check list alone remains insufficient proof.

10. **Freshness and placement.** Use this logic wherever the existing policy reader is called: initial inspection/application, saved inspection/resumption, per-merge guards and bounded check-wait polling. Obtain new evidence for each such attempt. Do not store absence proof as a lasting permission in recovery or cache. If this alternate route remains necessary but its identity, visibility, administrator access or protection prerequisites no longer validate, refuse the next protected effect. If normal REST inspection becomes available, assess its current requirements through existing guards. Preserve existing behavior where confirmed resumption can finish saved mandatory maintenance or wait for known running checks before final readiness; do not turn every pre-confirmation finding into a new blanket execution gate.

11. **Progress and recovery.** Dry-run and declined confirmation remain preserving inspections. Initial blockers refuse before landing effects. A refusal after earlier confirmed work preserves the existing recovery record and reached Git/GitHub state, identifies the next unattempted merge and does not repeat a merge request. Keep the existing recovery format and ownership/continuation rules. This change introduces neither rollback nor a new retry mechanism.

12. **Existing policy compatibility.** Keep complete REST pagination, canonical classic-policy identity checks, stricter combined review requirements, the union of required checks/publishers and exact-head publisher verification. Preserve the separate verified classic-404/ruleset-only path. A generic classic-protection 403 is not a newly accepted classic-absence result, even if its text mentions a plan. No permissive fallback follows from a failed alternate lookup.

13. **Execution boundaries.** Keep direct rebase merging, expected-head requests, scope selection, confirmation, survivor replay, leased publication, PR maintenance, landed-only cleanup and final checkout unchanged. Raw Git merge remains raw Git merge. No new GitHub writes are introduced by policy inspection.

14. **MCP and installed artifacts.** Reuse the existing MCP command tool and learning behavior. No protocol or configuration changes are required. Installed npm execution must find its normal gh executable and use the same configured repository and policy contract; no development-checkout path may be required.

15. **Evidence limits.** The accepted real observation demonstrates API availability and the disabled-rule shape on one private repository. It does not prove a paid-plan name, readiness of its PR, successful landing or general enterprise behavior. Local acceptance uses synthetic GitHub boundary data. GitHub/API changes can make previously available evidence unavailable; preserving refusal is the correct response.

16. **Race limits.** Separate GitHub reads and merge requests are not an atomic server-side transaction. Repeat the full existing guards immediately before the effects they protect, including after waiting or resuming; do not claim this repair eliminates every service-side race or that a prior preview authorizes later changed policy. GitHub's own merge enforcement remains in force.

## Testing Decisions

Use one primary acceptance seam: real public CLI processes operating on real temporary Git repositories and bare remotes, with only the external gh/GitHub boundary controlled. Assert output, exit status, independent Git observations and reached external fixture state. Do not mock internal policy, planner, replay or recovery helpers and do not test a helper in place of the user-visible path.

The existing landing policy guards, verified ruleset-only/classic protection cases, saved-plan terminal comparisons, check-waiting tests and real CLI/Git fixture snapshots provide prior art. Extend the existing external GitHub fixture rather than adding a second internal seam. Ordinary Git effects and hook execution remain real. Use an actual terminal when asserting confirmation and cancellation; the MCP smoke is a delivery check at the existing stdio boundary.

| Case | Required observable outcome |
| --- | --- |
| Specific first-page rules denial, private/admin identity, null classic protection and complete empty inventory | Preview completes policy inspection and can report readiness only if other requirements pass; local and remote state remain unchanged. |
| Same denial with one or several explicitly disabled rulesets | Same outcome; include the observed one-disabled-branch-ruleset shape. |
| Eligible proof followed by confirmed landing of a synthetic prefix | Correct merges, mandatory successor maintenance and landed-only cleanup occur once, preserving unique work and PR identities. |
| Disabled inventory spanning multiple pages, including a full final nonempty page | Read through explicit completion; all unique nodes/counts must agree before accepting. |
| Active inherited ruleset on a later page, active local rule or active rule with an apparently unrelated target | Refuse the alternate proof; do not silently reinterpret applicability or drop requirements. |
| Evaluate, unknown, omitted or null enforcement | Refuse with an accurate unsupported/unverified-evidence explanation. |
| Public/foreign repository, wrong trunk, absent ref, insufficient visibility or contradictory private/admin evidence | Nonzero preserving refusal; no ready claim or merge request. |
| REST `protected: true`, present classic rule, omitted classic-rule field or GraphQL response errors with otherwise plausible data | Nonzero preserving refusal. |
| Truncated pages, repeated/missing cursors, duplicate IDs, changing/mismatched totals, null nodes or exhausted pagination budget | Refuse incomplete proof; no later GitHub effect is authorized by a partial inventory. |
| Generic 401/403/404, rate limit, network error, malformed JSON, wrong subscription message/status/documentation URL or wrong failing endpoint | Keep existing refusal classification; do not invoke a permissive substitute. |
| Specific-looking failure after successful rules pages | Preserve ordinary pagination failure; never discard already observed policy to enter this alternate route. |
| Rebase disabled, failing/pending checks, missing required readiness, changed PR head/identity or remote lease | Retain the respective independent blocker despite successful absence verification. |
| Normal REST, classic-only, ruleset-only and combined policies | Existing stricter reviews, checks, publisher provenance and classic-404 evidence contracts remain intact. |
| Fresh inspection/application and paired saved ordinary/dry-run invocations against identical current responses | Same policy decision; saved routes show the same freshly inspected plan before confirmation. Dry-run stops and declined confirmation preserves repository, recovery and remote refs. |
| Saved landing with repeated plan denial and previously successful proof, then an active/inherited rule, revoked administrator visibility or incomplete lookup | Obtain fresh evidence and refuse before the next merge request, retaining confirmed work and recovery. |
| Known running checks during confirmed resumption, then policy activation while polling | Existing waiting remains usable; changed policy stops the next merge without repeating earlier merges or maintenance. |
| Saved mandatory maintenance followed by a fresh alternate policy check | Existing maintenance can complete under its normal guards; the new inspection does not deadlock recovery or skip next-merge protection. |
| One existing MCP stdio execution smoke | The actual CLI exhibits the same successful preview and preserving policy refusal through the normal output/status envelope, with no new tool. |
| Isolated installed npm candidate | Both command names remain usable and at least the successful disabled-rule preview and unverified-evidence refusal execute through the installed bundle. |

For read-only/refused cases, compare refs, branch metadata, checkout, index, worktree files, PR/cache and continuation/landing records, and remote refs. For refusals after reached work, compare against the last confirmed phase rather than expecting rollback to the initial state. Verify no new merge/push/PR-edit request beyond authorized reached progress. A readiness label or fixture call log alone is not acceptance.

Run a bounded relevant selection on pinned Node and native runtimes, plus the isolated npm delivery checks, typecheck, lint and formatting appropriate to the change. Use finite process deadlines and preserve reports. Process-tree MCP tests need an environment that permits their deliberate process observations; a sandbox-denied test hook is not evidence of a CLI failure or success. Do not change production guards to make a test environment pass.

No live GitHub merges, policy changes or account changes are part of acceptance. Do not run the full suite, CI, full matrix, Release workflow or publication as part of this specification or its local implementation acceptance. The user's working project is not a test fixture. A later live acceptance run, PR publication, merge, release or installation change requires its own authorized scope.

## Out of Scope

- Treating every HTTP 403, an empty checks list or `protected: false` as sufficient absence evidence.
- General GraphQL policy reconstruction, branch-pattern applicability evaluation, active or evaluate-mode ruleset support through this alternate route.
- Accepting non-admin visibility, public-repository contradictions or incomplete inherited inventories.
- New account-plan or billing integrations; changing subscriptions, repository visibility, access scopes, protections or rulesets.
- Force/admin bypass, auto-merge, queues, squash/merge-commit modes, changed merge/maintenance scope or different confirmation semantics.
- New command flags, MCP tools, stored metadata formats, cached proof exemptions or recovery migrations.
- Enterprise-host certification, cross-repository/fork-headed landing, multi-trunk support or other providers.
- Live project rewrites, live fixture merges, CI/full-matrix execution, release publication or active-installation updates.
- Implementing the separate beta-release-channel specification or other parity backlog.

## Further Notes

This is a targeted repair to Anthracite's own landing workflow, not a Graphite parity claim. Source baseline: [Anthracite 0.6.6 release commit](https://github.com/danielbaars/anthracite/commit/f03adc7075519b3c623e72e24ab6d8ce64c223e4). The [specification basis and sanitized observations](../verification/land-private-plan-policy-spec-2026-11-03.md) separate confirmed API behavior, design decisions and future acceptance.

GitHub documents [ruleset availability and disabled state](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository), the [repository ruleset connection and inherited inventories](https://docs.github.com/en/graphql/reference/repos#repository), and the [applicable-rules endpoint](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch). The REST endpoint omits disabled/evaluate rules, whereas the approved alternate route deliberately accepts only empty/all-disabled inventories. A plan-restricted endpoint response is an entry condition, not independent evidence of policy absence.
