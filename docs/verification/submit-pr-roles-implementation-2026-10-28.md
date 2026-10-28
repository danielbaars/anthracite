# Submit role implementation verification

## Candidate and result

The integrated implementation of [#29](https://github.com/danielbaars/anthracite/issues/29) and sub-issues #30–#33 was checked at `5285c564c38d43a587432b4cdb6c777b3e9cac5e`, relative to main `ddcb6d6b1083b797820a41232f2830f470969c4f`. The integration history is linear. All four ticket workstreams were integrated into the single `submit-pr-roles` branch.

The focused accepted selection passed on both runtimes: **69/69 Node and 69/69 native**, with zero failures and zero pending tests. The normal build, explicit no-emit typecheck and uncached production-source lint also passed. The native executable was independently compiled with Bun 1.3.14; its SHA-256 is `0e1ed913aded7f83189636c019cc320de2bd6263facbc82a179122841060d73a`.

The [result summary](evidence/submit-pr-roles-implementation-2026-10-28/summary.json) records each file, optional control selection and runtime outcome. The [manifest](evidence/submit-pr-roles-implementation-2026-10-28/manifest.json) records tested source/test trees and SHA-256 hashes of retained evidence. Runtime reports and build logs were copied unchanged and byte-verified before publication.

## Behavior exercised

| Contract groups                                                  | Public evidence                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1–T4: submission versus role scope, defaults, new/unchanged PRs | Targeted reviewer and assignee CLI cases; existing reviewer and scope controls                                                                     |
| T5–T6: recipients and target refusal                             | Users, teams, `@me`, duplicate and malformed input; excluded/frozen/deselected/update-only targets before pushes                                   |
| T7–T9: repetition, confirmation and partial progress             | Present assignees/pending requests; old versus new reviews; ignored/rejected/partial writes; incorrect readback; retained work and no later writes |
| T10–T11: preview and affected safeguards                         | Per-PR intentions without publication; draft policy; existing force-with-lease, pre-push, quiet, interaction and frozen controls                   |
| T12: public surface                                              | Actual terminal prompts, aliases, completion and closed-stdin preview, including malformed-list refusal                                            |
| T13: existing MCP                                                | One real stdio client workflow, checked on each runtime, with independent refs and target/non-target PR-role assertions                            |

Every new public feature case was rerun on the assembled candidate. Existing affected reviewer, preview and scope files ran in full; four interaction and two frozen controls were selected explicitly. Ticket verification additionally covered existing draft/publication and alias behavior. This is focused feature acceptance, not a claim that the complete repository suite ran.

The primary test seam remains the built public CLI in real temporary Git repositories and local bare remotes, with the existing external GitHub substitute. The MCP case reuses the established real client/server boundary. No private-handler test seam, new transport or production test hook was added.

## Standards

The independent [standards review](evidence/submit-pr-roles-implementation-2026-10-28/review-standards.md) reported **0 actionable findings** against repository guidance and the Fowler baseline.

## Spec

The independent [specification review](evidence/submit-pr-roles-implementation-2026-10-28/review-spec.md) reported **0 findings** against #29 and all four sub-issues. No review repairs were required.

Total open findings: standards **0**, specification **0**. Neither axis identified an outstanding issue.

## Delivery and limits

Submit retains its ordinary branch/publication behavior; `--roles-branch` only narrows the recipients of role additions. Assignees are transient execution data, with no stored stack migration. Existing roles are preserved, drafts are not implicitly published, and failure does not promise rollback of already reached Git/GitHub work.

The controlled GitHub fixture proves Anthracite's planning, command execution, readback and failure contract. No live GitHub review requests were sent, so these results do not claim to validate every remote permission or team-eligibility policy. No full CI matrix, release assets, global installation or MCP registration change was performed. Only the existing inexpensive automatic CI is allowed for the single implementation PR. The owner's publication and exact-metadata approval process remains authoritative.
