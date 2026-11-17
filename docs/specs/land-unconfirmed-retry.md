# Explicit retry of an unconfirmed landing merge

Scope and the public-process test boundary approved on 17 November 2026. This specifies proposed behavior for reopened [issue #189](https://github.com/danielbaars/anthracite/issues/189); the option is not available in Anthracite 0.8.2.

## Problem Statement

A lost or unclassified merge response leaves a landing in `merge-requested`. Anthracite 0.8.2 reports definite refusals better, but cannot recover the missing evidence in older records. An open, unmerged PR alone does not establish that the earlier request failed. Ordinary resumption therefore refuses indefinitely, blocks other mutations, and offers no supported deliberate retry.

Users need a bounded way to authorize another request without editing recovery files, repeating confirmed merges or losing unfinished maintenance.

## Solution

Add `land <original-target> --retry-unconfirmed`. It explicitly authorizes one new merge request for the current saved PR and effective head, subject to fresh verification. It does not reinterpret the earlier request as rejected. Existing confirmation remains required: interactive approval or `--yes` for unattended execution.

With `--dry-run`, disclose the proposed retry and remaining original landing scope without writes. If fresh evidence instead confirms the PR already merged, reconcile that result without another merge request. Preserve completed work and the original publication schedule throughout.

## User Stories

1. As a developer, I want a named recovery option, so that I can deliberately recover an unconfirmed landing.
2. As a developer, I want plain `--yes` to remain insufficient, so that normal resumption cannot silently repeat a request.
3. As a developer, I want a preserving preview, so that I can see the exact PR, head and remaining work before consenting.
4. As a developer, I want declining confirmation to preserve recovery, so that inspection does not commit me to a retry.
5. As a developer, I want valid older records supported, so that upgrading provides a real exit for the reported case.
6. As a developer, I want the saved publication schedule retained, so that recovery does not convert eager and deferred landings.
7. As a developer, I want pinned PR and remote identities checked, so that reused names or changed heads cannot redirect the request.
8. As a reviewer, I want current policy, approvals and required checks enforced, so that recovery cannot bypass protection.
9. As a developer, I want an already merged PR recognized, so that recovery never repeats its confirmed merge.
10. As a developer, I want one invocation to authorize at most one uncertain-request retry, so that later uncertainty needs new consent.
11. As a developer, I want evidence retained before the request, so that interruption does not erase what was attempted.
12. As a developer, I want uncertain outcomes preserved, so that another lost response cannot become permission to retry automatically.
13. As a developer, I want earlier merges and mandatory survivor work retained, so that partially completed stacks remain recoverable.
14. As a developer, I want distinct refusal, confirmation and uncertainty messages, so that the next action is executable and accurate.
15. As a developer, I want inappropriate or blocked requests refused without effects, so that the flag is not a general force option.
16. As an agent, I want the same option through existing MCP execution, so that recovery needs no private-file edits or new tool.
17. As a maintainer, I want unsupported readers to preserve pending evidence, so that switching executables cannot erase consent boundaries.
18. As a developer, I want an explicit retry distinguished from proof of failure, so that later attempts do not inherit invented certainty.

## Implementation Decisions

- **Eligibility:** require the explicit saved original target and a valid, owned landing in `merge-requested`. Accept supported older version-1/version-2 records without rejection evidence, and supported retry-capable records retaining that original scheduling authority. Refuse absent, malformed, foreign, concurrently changed or inappropriate-phase records before effects; do not start a new landing with this option. The retry concerns the current saved merge, not whichever PR discovery now prefers.
- **Consent:** the named flag grants one new request for that current PR/effective head within this invocation. Normal plan confirmation is additional. Neither plain `--yes`, a prior preview nor a saved retry intent grants a later invocation this permission. The option is not permission to reset history, change scope or ignore uncertainty.
- **Fresh eligibility:** independently verify repository and declared remote identity, pinned PR number/URL/head branch, explicit OPEN/unmerged status, and agreement among the effective saved head, local ref, remote ref and PR head. Use recorded reached identity after maintenance, not a stale initial capture. Require the expected trunk base; both the effective saved replay boundary and fresh PR base snapshot must be verified ancestors of current remote trunk. Preserve trunk fast-forward and prior confirmed-result reachability guards.
- **Current protection:** retain all local/recovery ownership, clean-index/worktree, Git-operation, frozen, worktree-occupancy, participant, metadata and lease protections. Re-read current repository policy, reviews and required-check/publisher evidence immediately before the request. Existing optional-check disclosure and bounded required-check waiting apply after confirmation; dry-runs never wait. Unavailable or conflicting evidence refuses.
- **Preserving plan:** ordinary resumption keeps its existing uncertainty blocker. An opted-in preview instead identifies the proposed new request, remaining uncertainty, any real blockers, prior confirmed merges, maintenance/publication obligations and final checkout. Actual confirmation uses the same fresh inspection. Preview and declined confirmation write no refs, index/files, metadata/cache, recovery or retry evidence, and make no GitHub writes.
- **Durable attempt:** preserve the original recovery bytes and uncertainty evidence before replacing active progress. Durably bind the new attempt to its source record, original project, current PR/head, scope and invocation before sending it. Preserve ownership, private-file, atomic-write and concurrent-change protections. This records attempted authority; it is not reusable consent or proof the original request failed.
- **Interruption and readers:** interrupted intent, a lost response or an unknown result leaves an owned, guarded operation with an accurate next action. Do not temporarily expose an ordinary `prepared` state that an older reader or plain resumption could treat as retry permission. Gate unsupported readers where needed; preserve their input evidence on refusal. Keep version-1 eager and version-2 deferred scheduling semantics; no broad format or scheduling migration is authorized.
- **Outcome:** freshly confirmed matching merges proceed through ordinary result/ancestry verification without another request. A race that completes the earlier merge is handled the same way. Definite rejection shows the concrete reason; unknown outcomes remain unconfirmed. While an older attempt is still unconfirmed, rejection of the new request alone cannot establish that the older one failed or enable plain resumption. At most one new merge request is sent under this invocation's exceptional consent.
- **Continuation:** after a confirmed result, continue only the disclosed remaining original landing scope under normal confirmation and guards. Keep previous merge results, reached heads, pending replay/push/base/footer work, leases, source evidence and checkout intent. Another uncertain merge later in the chain does not inherit the flag. Existing local conflict continuation remains local-only.
- **Delivery:** help, completion, errors and existing MCP learning explain the option, its preview, additional confirmation and eligibility. Clearly distinguish no request sent, new request sent, definite refusal, confirmed result and uncertain outcome. Name a usable next command without suggesting blind repetition or record deletion. No new MCP tool is added.

## Testing Decisions

Use one existing seam: public Anthracite CLI processes with real temporary Git repositories and bare remotes. Control only GitHub responses/effects at the existing gh boundary. Assert observable requests, actual remote/local Git state, preserving refusals and usable subsequent commands; do not test private helpers or require new production test interfaces.

Prior art is the public leaf-landing, interruption/recovery, merge-refusal, pending-plan, deferred-publication and installed CLI/MCP acceptance coverage. Preserve the existing accepted-but-lost-response and expected-head race controls.

| Scenario                       | Required observation                                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older producer                 | An unmodified record made by a genuinely published older npm CLI can enter this route; retain its bytes and scheduling evidence.                                                                                                                                        |
| Consent and preview            | Without the flag, including plain `--yes`, no new request. Opted-in dry-run discloses exactly one candidate and all remaining work. Declining confirmation preserves state. Ineligible target/phase/record refuses.                                                     |
| Successful recovery            | Fresh matching open PR permits one explicitly confirmed request; confirm the result and complete the original workflow. Verify the expected head in the real outbound request.                                                                                          |
| Already merged and races       | Confirmation before retry sends no new request. Completion between inspection and effect reconciles the matching result. Changed identity/head/base, unrelated trunk history, closed-unmerged PR or unavailable evidence refuses without expanding authority.           |
| Protection                     | Dirty files/index, frozen or occupied participants, concurrent progress changes, changed policy/approval and failed or unavailable required checks remain authoritative. Optional checks retain their existing behavior.                                                |
| Interrupted or uncertain retry | Interrupt around durable intent, request and readback. Preserve reached work and evidence; plain resumption and unsupported readers cannot send another request or erase the gate. Persistent uncertainty and a definite new rejection retain the original uncertainty. |
| Partial stack                  | Preserve earlier confirmed merges and a current reached head rewritten by maintenance. Never repeat earlier merges; retain remaining descendants, survivors, unpublished branches, cleanup and the original eager/deferred schedule.                                    |
| Delivery                       | Focused Node and native runs, selected isolated installed-npm cases and one existing MCP-client smoke cover learning, preview and bounded execution.                                                                                                                    |

Acquire older npm producers only into isolated temporary locations. Controlled GitHub effects do not claim live GitHub acceptance. During specification, run only document/link consistency checks: no CI, live GitHub test PRs, user-project mutations or installation changes. The full CI matrix remains off.

## Out of Scope

General `land --abort`, clearing or discarding records, automatic retry, historical-proof reconstruction, record editing by hand, force/bypass modes, changed merge methods or queues, new branch discovery, scope expansion, publication-schedule conversion, general orphan repair, sync/get changes, new MCP tools and release/installation changes.

## Further Notes

The [reopening report](https://github.com/danielbaars/anthracite/issues/189#issuecomment-6946157284) is the acceptance starting point. [Published 0.8.2 landing behavior](https://github.com/danielbaars/anthracite/blob/v0.8.2/docs/land.md) explains why the existing record remains blocked. That is current behavior, not acceptance of this proposed recovery route. Keep the original report and reopening history when publishing this specification.

The retry is new authority under acknowledged uncertainty, not an exactly-once delivery guarantee. It may race with an earlier in-flight request; expected-head constraints, fresh result verification and retained attempt evidence bound that recovery.
