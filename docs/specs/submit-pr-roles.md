## Problem Statement

When a developer submits a stack, different pull requests can require different reviewers and assignees. Anthracite currently applies an explicit reviewer list to every selected submission branch and has no assignee option. Interactive reviewer prompts can vary by branch, but agents cannot use those prompts to target one PR. Changing the submission starting branch does not solve this: its ancestors remain in scope.

Using a separate Anthracite PR editor would largely duplicate `gh pr edit`. The missing value is integration with submission: submit the intended stack while adding reviewers and assignees only to the intended PR, without changing existing roles on the other PRs.

## Solution

Extend `submit` with `--assignees <names>` and `--roles-branch <branch>`. The role target is independent of the submission starting branch and scope. One invocation uses one shared target for its supplied reviewers and assignees; without an explicit role target, both lists apply to every selected submission PR, preserving existing reviewer behavior.

For example, `an submit --stack --reviewers alice,bob --assignees @me --roles-branch feature-b` submits the selected stack but adds Alice and Bob as reviewers and the authenticated user as an assignee only on the PR for `feature-b`. Other PRs may receive ordinary submission updates, but their reviewer requests and assignees remain untouched.

Add roles without removing existing ones. Refuse an excluded or invalid explicit target before pushing. Preserve existing draft/publication controls, show per-PR role intentions in previews, confirm reached changes, and stop honestly on failure without automatic rollback. Keep standalone editing and removal in `gh`.

## User Stories

1. As a developer, I want to submit a stack while assigning reviewers to one PR, so that unrelated PRs do not receive review requests.
2. As a developer, I want to assign responsibility during submission, so that I do not need a separate command to add assignees.
3. As a developer, I want reviewers and assignees to remain distinct roles, so that requesting review does not imply assigning responsibility.
4. As an agent user, I want explicit role targeting without prompts, so that I can use the existing MCP execution tool.
5. As a CLI user, I want one shared role target per invocation, so that the command has an unambiguous recipient scope.
6. As a CLI user, I want to target an exact local branch name, so that I do not need to discover a PR number before submitting it.
7. As a developer, I want the role target to leave the submitted branch set unchanged, so that all intended stack updates still occur.
8. As a developer, I want the submission starting branch to remain independent of the role target, so that I can submit from one branch and add roles on another selected PR.
9. As an existing user, I want reviewer lists without an explicit role target to retain their scope-wide behavior, so that scripts do not silently change meaning.
10. As a CLI user, I want assignee lists without an explicit role target to use the same scope as reviewer lists, so that the two options behave consistently.
11. As a CLI user, I want to supply reviewers without assignees, so that review requests remain independently usable.
12. As a CLI user, I want to supply assignees without reviewers, so that assigning responsibility does not request review.
13. As a CLI user, I want comma-separated recipients with surrounding whitespace handled consistently, so that ordinary command construction is predictable.
14. As a developer, I want to request review from users and organization teams, so that existing team-review workflows remain available.
15. As a developer, I want to use `@me` for an assignee, so that assignment uses my authenticated GitHub identity.
16. As a CLI user, I want duplicate recipients treated as one addition, so that repeated names do not cause redundant changes.
17. As a CLI user, I want invalid or empty explicit recipient input to fail clearly, so that missing arguments cannot silently produce an incomplete result.
18. As an interactive user, I want the existing bare-reviewer prompt to remain available, so that interactive workflows keep working.
19. As an interactive user, I want a role target to restrict reviewer prompts to that target, so that I am not asked to assign reviewers to other PRs.
20. As a developer, I want role additions to work on new PRs, so that ownership and review can be established during initial submission.
21. As a developer, I want role additions to work on unchanged existing PRs, so that I do not need artificial commits or `--always`.
22. As a developer, I want existing unrelated reviewers and assignees preserved, so that submission does not replace manually maintained roles.
23. As a developer, I want non-target PRs to receive no role changes, so that submitting code does not alter their review or ownership workflow.
24. As a developer, I want already pending review requests left alone, so that retrying does not reissue achieved requests.
25. As a developer, I want already present assignees left alone, so that retrying does not redundantly add them.
26. As a developer, I want an explicit reviewer option to request review again after a completed review, so that I can ask for another review round.
27. As a developer, I want a review completed during request confirmation recognized as progress, so that a promptly fulfilled request is not reported as missing.
28. As a developer, I want an invalid or unknown explicit target rejected before pushing, so that a typo cannot partially submit the stack.
29. As a developer, I want targets outside the final selected branch set rejected, so that role options never expand submission scope.
30. As a developer, I want a frozen explicit target rejected before pushing, so that role targeting does not bypass protection.
31. As a developer, I want an explicit target skipped by update-only rejected, so that requested role changes are not silently omitted.
32. As an interactive user, I want an explicitly targeted PR excluded by my selection to produce an early error, so that my selection is respected.
33. As a developer, I want drafts to remain drafts unless I explicitly request publication, so that role options cannot publish unfinished work.
34. As a developer, I want explicit draft and publish options to retain their existing behavior, so that role management does not introduce another status policy.
35. As a CLI user, I want dry-run to show the submission set and each PR's intended role additions, so that I can review the full effect before executing it.
36. As a CLI user, I want preview to avoid pushes and PR mutations, so that inspecting role intentions has no publication effects.
37. As a developer, I want confirmation from the intended GitHub PR rather than just a successful process exit, so that ignored or misdirected updates do not look successful.
38. As a developer, I want submission to stop at its first failure, so that subsequent work is not unexpectedly performed after an error.
39. As a developer, I want confirmed progress retained after a failure, so that successful submissions and role additions are not rolled back.
40. As an agent user, I want confirmed, failed and unattempted work distinguished with a nonzero failure status, so that I can choose a safe next action.
41. As a developer, I want refused role changes reported without deferred background work, so that later commands do not unexpectedly send requests.
42. As a CLI user, I want help, existing submit routes and branch completion to expose the new options consistently, so that the feature is discoverable.
43. As a maintainer, I want focused public-behavior tests on Node and the native executable, so that runtime differences are checked without running the full CI matrix.
44. As a maintainer, I want to reuse the existing CLI, GitHub-substitute and MCP test boundaries, so that the implementation does not create a parallel test architecture.

## Implementation Decisions

1. **One submission workflow, two scopes.** Extend command registration, submission preparation, preview and PR execution rather than adding a standalone editor. Submission selection retains its existing starting-branch, downstack, stack, interactive-selection, frozen-skip and update-only rules. Role targeting is a separate decision within that selection and must not change it.

2. **Public options.** Add the string options `--assignees` and `--roles-branch` to the canonical submit interface and its existing aliases/routes. The role target is an exact local branch name; it is not a PR number, URL, branch pattern, implicit current-branch keyword or second submission starting point. Both supplied role lists share that target. Without it, supplied roles apply to all eligible selected PRs. Supplying neither role list keeps ordinary submission behavior.

3. **Recipient input and interaction.** Use comma-separated lists and trim entries. Deduplicate identity-equivalent names while retaining the intended GitHub identity. Reviewers accept existing user and organization/team forms; assignees accept users and `@me`, resolved using the active GitHub account for the repository. An explicit empty assignee list or missing assignee argument is an input error rather than a new prompt. Preserve existing bare-reviewer prompting and noninteractive empty-reviewer refusal. With a target, only that branch receives reviewer prompts; without a target, existing per-branch prompting remains. Do not prompt during dry-run or noninteractive/MCP execution. An option combination with a role target but no role input must not silently claim a role update.

4. **Resolve eligibility before writes.** Validate the explicit target against the final selected, editable, update-only-eligible branch set before any push or PR mutation. Reject unknown, trunk, frozen, out-of-scope, interactively deselected and update-only-skipped targets with an actionable error. Do not silently succeed through an empty-selection return when an explicit target was excluded. Read-only GitHub discovery needed for eligibility is allowed. A selected existing PR that is unchanged remains eligible for explicit role additions; ordinary no-op optimization must not discard that intent. Continue existing protection checks immediately before mutations; if eligibility changes after work has begun, stop and report reached work rather than claiming an early no-change refusal.

5. **Per-PR plans.** Preparation carries the intended reviewer and assignee additions for each eligible PR. With a role target, do not attach lists or role-only actions to non-target PRs. Without one, preserve scope-wide intent. A role-only request must work for an unchanged existing PR without requiring `--always`; this does not turn submission into a no-push standalone editor. Non-target PRs may still receive ordinary code, base, status and dependency-footer changes authorized by submission.

6. **Reuse GitHub integration.** Execute through the established local GitHub CLI integration with literal arguments and explicit repository/PR identity. New PRs must be created and associated before their roles can be changed. Use per-submission execution data for assignees and targeting; do not add a durable role queue, migrate stack metadata or require a Graphite service. Existing stored stack, PR association and recovery compatibility remain authoritative.

7. **Additive roles and readback.** Read the intended PR's current roles, add only missing pending reviewer requests and missing assignees, and preserve unrelated roles. Validate readback against the expected repository, PR number and head branch. A successful subprocess exit alone is not proof of the requested outcome. Recognize partial or ignored changes; report only independently confirmed progress. Preserve the existing distinction between pending requests, historical reviews and a new review completed during request confirmation, including supported team confirmation behavior.

8. **Review repetition.** An existing pending request satisfies that addition without reissuing it. A historical completed review does not satisfy an explicit new review request. If a request is fulfilled during the operation, a newly observed review can confirm it. An existing assignee satisfies an addition without a redundant write. Safe repetition means preserving present assignees and pending requests; it does not prohibit a fresh explicit request after a completed review. No cross-invocation durable idempotency job is introduced.

9. **Draft and publication policy.** Role options never implicitly publish a PR. Preserve explicit draft/publish semantics and the existing default for new noninteractive PRs. When GitHub refuses a role update, surface that refusal under the partial-progress contract; do not publish, store a deferred request, drop the requested role or report success as a workaround.

10. **Failure contract.** Stop submission at the first failed push, PR action or role change. Preserve completed pushes, PR creation/updates and confirmed role additions. Do not continue later PR submissions, later role steps or final footer refresh after failure. Report the affected branch/PR, confirmed changes, the failure and subsequent work not attempted, with a nonzero exit status. If a failed write may have partially succeeded, use readback where available and distinguish unverified state from confirmed success. Do not undo reached work or automatically retry failed mutations. Reuse existing failure handling instead of defining a second submission lifecycle.

11. **Preview and output.** Dry-run identifies the selected PRs and their intended reviewer and assignee additions, alongside existing code/status actions, with no branch pushes or PR writes. Explicit targets and preserved scope-wide behavior must be visible. If bare reviewer input would require an interactive choice, preview identifies that unresolved choice without prompting or inventing recipients. Normal execution and failure reporting explain role outcomes; preserve global quiet/error policy. Do not promise an exact prose layout or introduce a new machine-readable output protocol.

12. **Help, completion and MCP.** Document the independent submission/role scopes, scope-wide defaults, additive behavior and exact branch selector. Extend existing submit-route completion for the new branch-valued option without remote writes or prompts. The existing MCP execution tool forwards literal arguments and receives the ordinary process result; no new MCP tool, transport, permission model or server registration is required. Agent use remains subject to existing publication approvals.

13. **Delivery limits.** This issue authorizes specification publication, not feature implementation or a release. During later implementation use the approved focused local verification and existing inexpensive automatic CI only. Do not dispatch the full CI matrix, send live review requests, install a candidate globally, or publish release assets as part of this scope.

## Testing Decisions

Use one main product seam: invoke the built public CLI in real temporary Git repositories with real local Git remotes and the existing controlled GitHub substitute. Extend that substitute to represent assignees, authenticated identity, reviewer/team state and representative failures; observe calls and independent final state instead of mocking internal planners or exporting private helpers. A good test proves the intended submission and role outcome, non-target preservation, or the reached state after a refusal/failure. It does not assert helper names, private call graphs or an implementation-generated expected result.

Reuse the existing public submit reviewer, preview, scope, publication, draft, frozen and interaction fixtures. Their prior art includes unchanged-PR role requests, preservation of a sibling PR, readback mismatch, ignored/partial/rejected requests, historical versus newly fulfilled reviews, actual terminal prompts, frozen rechecks and retained progress after publication failure. Existing completion and modern submit-route tests cover discoverability and alias behavior. No new engine-level seam or broad protocol matrix is needed.

The approved cases are bounded scenario groups, not a requirement for a Cartesian product of flags and runtimes beyond the focused accepted set:

| Case                                 | Observable acceptance                                                                                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 — target within a stack           | Submit a chain with a descendant and an unrelated sibling stack; only the explicitly targeted PR gains both roles. Intended submission refs advance, existing non-target roles and the sibling remain unchanged.                                                                       |
| T2 — starting branch versus target   | Select submission from another branch without checkout, target an eligible ancestor or descendant, and demonstrate that role targeting neither narrows nor expands the ordinary submission set.                                                                                        |
| T3 — defaults and independent lists  | Without a target, supplied lists apply scope-wide. Reviewer-only, assignee-only and neither-role invocations preserve the agreed behavior and existing roles.                                                                                                                          |
| T4 — new and unchanged PRs           | Add roles on initial creation and on an unchanged existing target without artificial commits or `--always`; other unchanged PRs do not acquire role actions. Preserve PR identity and approved content apart from ordinary submit effects.                                             |
| T5 — recipients                      | Cover whitespace, duplicate names, a reviewer team, multiple assignees, authenticated `@me`, and empty/missing assignee or invalid noninteractive reviewer input. Input refusal precedes pushes and PR mutations.                                                                      |
| T6 — target refusals                 | Unknown/trunk, out-of-scope, frozen, deselected and update-only-skipped explicit targets fail before pushes or PR writes. Include an all-excluded target so an early no-op return cannot conceal the error.                                                                            |
| T7 — repetition and preservation     | Already pending reviews and present assignees cause no redundant additions; unrelated roles remain. A completed old review causes a new explicit request, and a review completed during confirmation counts as achieved progress.                                                      |
| T8 — truthful confirmation           | A zero-exit ignored update, partial assignment, rejected recipient and wrong-PR/head readback fail honestly. Never infer success from the write exit alone or from an old review.                                                                                                      |
| T9 — partial progress                | Arrange a deterministic later role failure after earlier push/PR/role progress. Confirm retained state, nonzero status, no later submission/role/footer writes and clear confirmed/failed/unattempted reporting. A repeat preserves achieved roles and can finish remaining additions. |
| T10 — preview                        | Show the submission set and per-PR role intentions for creation, code update and an unchanged target; defaults remain scope-wide. No pushes or PR writes occur, and bare reviewer preview does not prompt.                                                                             |
| T11 — drafts and regression controls | Roles never implicitly publish. Existing explicit draft/publish, update-only, force-with-lease, hooks, frozen rechecks, quiet/error behavior and ordinary submit behavior remain intact in representative affected controls.                                                           |
| T12 — interactive and public surface | A real terminal preserves existing reviewer prompting and restricts it to the target when provided. Help/completion and existing submit routes expose and forward both new options. Noninteractive execution never waits for input.                                                    |
| T13 — MCP                            | Use one existing real stdio client to invoke submission with explicit roles and target in a synthetic stack. Observe the ordinary success envelope and the same independent PR/role state as the public CLI. No new MCP protocol or tools.                                             |

Run the focused CLI acceptance groups and affected existing controls locally on Node and an independently compiled native executable, retaining per-runtime results. Add only the single MCP execution check at the existing stdio boundary. Full CI matrix dispatch and live GitHub requests are not required. Fixture evidence establishes Anthracite's planning, argument forwarding, confirmation and failure contract; it does not claim live validation of every GitHub authorization or team policy.

## Out of Scope

- A standalone Anthracite PR editor; use `gh` for separate edits to existing PRs.
- Removing, replacing or clearing reviewers or assignees.
- Different recipient lists for multiple target PRs in one invocation, role mappings, wildcard branch targets, or explicit PR-number/URL targeting.
- Changing submission defaults, adding a submit-only mode, bypassing frozen protection, or using role options to select extra branches.
- Automatically publishing drafts to accommodate role requests, deferred role jobs, automatic rollback, or durable retry bookkeeping.
- GitHub account provisioning, repository permissions, reviewer eligibility policy, new hosting backends or Graphite authentication.
- New MCP tools/protocols, a replacement test architecture, exhaustive flag matrices, live notification tests, full CI matrix runs, releases or global installation.

## Further Notes

The [approved design](../design/pr-reviewers-and-assignees.md) and [domain glossary](../../GLOSSARY.md) retain the vocabulary and decision history. The owner approved the design in successive interview rounds and explicitly approved the testing boundary before this specification was written. The final direction supersedes the initial standalone-editor proposal: Anthracite adds value by integrating role targeting into submission, while `gh` remains the tool for standalone edits and removals.

The glossary distinguishes a reviewer, who is asked to assess changes, from an assignee, who is responsible for progressing the PR. Neither role implies the other. This specification records Anthracite product decisions; it makes no claim that the proposed option names reproduce Graphite's interface.

This is an agreed implementation contract, not evidence that the feature has been implemented or that its new acceptance cases have passed.
