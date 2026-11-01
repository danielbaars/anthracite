# Sync updates: specification decisions and evidence

Date: **31 October 2026**. The owner approved the scope and primary test seam before this specification. [Full specification](../specs/sync-updates.md), [approval record](evidence/sync-updates-spec-2026-10-31/approved-boundary.json).

This delivery publishes documentation only. It performs source/hash, evidence-copy, consistency and link checks. It adds no executable behavior, runtime feature acceptance, live fixture change, CI run, full matrix, dependency/version change, release or owner-installation change.

## Baseline and source bridge

The implementation baseline is [merged main `26c8b643`](https://github.com/danielbaars/anthracite/tree/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd), after [PR #77](https://github.com/danielbaars/anthracite/pull/77). Public npm 0.5.1 remains a different source boundary: its released commit is `5f76186bcfd2ee0952b9cb48bab1ddf94f00c3c5`; it did not ship the get extension.

The [source bridge](evidence/sync-updates-spec-2026-10-31/source-bridge.json) hashes five complete sync surface modules at merged main, released 0.5.1 and the historical 0.5.0 research source. All five are unchanged since 0.5.1: top-level sync registration, legacy repo-sync builder, sync action, cleanup action and PR-info refresh. Cleanup differs from 0.5.0 because B02 was repaired; the other four match. This supports carrying forward those exact source observations, not claiming whole-program runtime identity. Shared get/engine/replay code changed in #77 and is indexed separately.

Current source still defaults pull/delete to true, restack/force to false, and contains no delete-all option. The action refreshes PR data rather than feature heads. Force can authorize trunk reset and bypass cleanup prompts. Explicitly disabled GitHub integration currently skips PR lookups; the specification retains that local mode without silently requiring authentication. Existing cleanup traverses below open/declined parents and plans frozen mandatory survivors; that is the repaired B02 boundary, not unfinished parity work.

## Measured evidence and its limits

The [original paired research](https://github.com/danielbaars/anthracite/blob/78937d87424a331de34c2cf3cf95a8944c8d6ff5/docs/verification/get-sync-parity-2026-10-31.md) compares Graphite **1.8.6** with Anthracite **0.5.0**, on macOS ARM64 using Node24.19.0/REA6.7.0. Its ledger records 35 scenario-command observations, including three initial native-unsubmitted observations, plus six separately labeled controlled-gh observations. These are not test-pass counts and are not executions of the new sync design.

[The retained index](evidence/sync-updates-spec-2026-10-31/historical-evidence-index.json) indexes **nine historical observations and 27 raw capture/before/after files**, reused at their original immutable URLs and SHA-256 verified from research commit `78937d87424a331de34c2cf3cf95a8944c8d6ff5`. The complete original ledger is retained unchanged as context. Original report, help and independent audit URLs/hashes are indexed, not rewritten as current evidence.

| Observation | What was actually measured | Design consequence, not new acceptance |
| --- | --- | --- |
| S11, paired sync no-restack | Graphite advances the existing child feature head; Anthracite refreshes PR data but retains its old head. | Add existing-feature refresh independently of automatic replay. |
| S12, Graphite default sync | Graphite replays the stale tip and preserves its unique file/content. This is not a paired Anthracite-default runtime test. Anthracite's false default is source/help evidence. | Explicitly choose default restack for Anthracite and test it, including content/authors/messages and a no-restack control. |
| D21, paired divergent trunk | Graphite delete-all refuses/reset is not authorized and preserves its local-only trunk commit; Anthracite force resets trunk, as its documented contract permits. | Add narrow delete-all consent without silently changing existing sync force or get's FF-only contract. |
| C21, paired known cleanup | Both remove known merged/closed reachable candidates; Graphite also refreshes the surviving child and Anthracite does not. | Specify incoming refresh, approved cleanup and survivor maintenance as distinct ordered phases. |
| C23, paired known closed descendant | Historical Anthracite leaves known CLOSED tip15 below OPEN14; Graphite removes it. The association was verified before/after. | Preserve the already shipped B02 repair as a regression boundary; do not re-open it as a missing feature. |

The experiments do not establish every multi-root sync selection, arbitrary dirty state, resumed cleanup status check, concurrent hook, interrupted replay, remote-only discovery or platform combination. Selecting every existing tracked branch of the configured trunk is an explicit bounded Anthracite product decision in this spec. It is not claimed as a newly measured Graphite all-stack guarantee. No additional runtime comparison was necessary to establish the three measured priorities, and none was performed here.

## Decisions for this round

- **Existing local graph only:** all existing tracked branches under one configured trunk, regardless of checkout; no missing-branch imports or remote-only discovery. Open published branches can refresh, unpublished work stays local, closed/merged associations feed cleanup and need no deleted remote head.
- **Separate authority:** delete-all bypasses only existing eligible local-cleanup questions. Force retains its existing cleanup/trunk reset contract, not new feature-overwrite permission. No-pull remains trunk-only and no-delete suppresses cleanup. Existing explicit feature reconciliation is distinct from automatic replay.
- **Explicit phases:** snapshot/choices/preflight, trunk, all incoming features, approved local cleanup, maintenance, final checkout/owned cleanup. Saved PR parents and effective cleanup survivor parents are separate; no remote PR edits or branch resurrection.
- **Changed default:** restack becomes enabled, with no-restack preserving deliberate deferral. Feature refresh is new behavior even with no-restack/no-pull. There is deliberately no exact flag recipe for the former PR-info-only sync and no feature-refresh switch in this round; document the change rather than promise compatibility that does not exist.
- **Retained safety:** frozen inbound status, conservative local-work protection, worktree boundaries, B02 traversal and required survivor policy. Owned continuation preserves sources, prior choices and final checkout, checks protection before continue-all staging and never expands cleanup. Pending cleanup after a pause rechecks its exact PR states, requiring GitHub read access where necessary.
- **Honest completion:** restore the original surviving checkout or explicitly fall back to trunk only when this operation deleted that branch. Validate expected graph and physical checkout after final hooks/source cleanup; preserve actual partial work with nonzero/manual guidance on mismatch. No transaction/rollback claim.

## Reuse and prior art

The [get specification](../specs/get-updates.md) deliberately excluded sync changes. Its [completed implementation verification](get-updates-implementation-2026-10-31.md) distinguishes initial failures, fixes, source-qualified local checks and resolved independent reviews. The final get completion check was repaired after real final-checkout/source-cleanup hooks demonstrated false success; this is a mandatory regression boundary for sync reuse, not a universal proof of the new operation.

Reuse the bounded graph snapshots/application, per-node sources/parents, local maintenance, optional owned record/marker and final-state checks with explicit **sync** policy. Do not invoke public get repeatedly or inherit get's target/default selection, import behavior, FF-only trunk policy or cleanup exclusion by accident. Conversely, do not introduce sync trunk-reset or cleanup authority into get. Existing legacy continuations and structural/landing guards remain separate.

Primary acceptance prior art:

- [Frozen sync and public routes](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/frozen_sync_cli.test.ts), [sync fixture](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/lib/fixtures/frozen_sync_cli.ts).
- [B02 public cleanup cases](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/sync_cleanup_descendants_cli.test.ts), [released repair verification](sync-cleanup-descendants-2026-10-31.md).
- [Legacy sync](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/repo/sync.test.ts) and [legacy continuation](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/repo/sync_continue.test.ts).
- [Get graph](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/get_graph_cli.test.ts), [owned recovery](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/get_recovery_cli.test.ts) and [publication/completion controls](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/commands/get_publication_cli.test.ts).
- [Real stdio MCP client](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/apps/cli/test/lib/mcp_client.ts) and [installed npm gate](https://github.com/danielbaars/anthracite/blob/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd/scripts/test-npm-package.cjs). Exactly one bounded sync smoke extends this existing route; it is not another exhaustive matrix.

The approved primary seam is public CLI/real Git/bare remotes with controlled external GitHub responses. New tests must independently inspect actual Git state, not private plan objects or engine mocks. Existing real terminal helpers cover choices; Node/native and exact isolated package acceptance are later implementation obligations. Isolate global Git configuration but retain explicit local updateRefs=true tests to prove scoped protection. Do not use B01's ineffective an test selectors to bound checks.

## Validation and publication

The [validation receipt](evidence/sync-updates-spec-2026-10-31/validation.json) records document structure, story/decision/test-group consistency, relative links and immutable evidence/source hashes. The [receipt guide](evidence/sync-updates-spec-2026-10-31/README.md) distinguishes the historical evidence from new design decisions. These checks validate this documentation delivery; none means the proposed sync implementation passes acceptance.

The documentation branch is committed/pushed with skip-CI protection before issue publication, and the issue links exact reachable files. No implementation tickets/PR, Graphite runtime claim, live GitHub fixture, release or installation is created here. The parity register retains G07/U01 as open sync work and G05/#12 as separate deferred work; this spec does not close them or declare complete parity.
