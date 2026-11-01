# Ticket 83 implementation report

## Identity and scope

Exclusive worktree `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/83`, branch `sync-updates-83`. Exact clean start `5876b761ef4a2b3428ae38e1ff14653a6b7a22d9` (79–82 integrated). Explicit seven-path staging and Anthracite MCP `modify --commit --message` produced `bd913c62abd13a0aca4ffac7a3a15cff54b1fbd0`, `feat(sync): maintain affected tracked stacks by default [skip ci]`. `an merge sync-updates --no-edit` reported already up to date. CLI source tree `c5f6ce65bf728fc1d2a01d51e607d2da88d35616`.

No worker push, GitHub mutation, CI/full matrix, release, installation or dependency changes. No subdelegation. All tests use public processes and real temporary Git; only external gh responses are controlled. The existing legacy scene uses explicitly disabled integration. Global Git configuration was isolated; explicit local rebase.updateRefs=true cases retain that setting.

## Behavior and interface

Sync/repo sync/repo s default restack is true, retaining `-r`, explicit boolean and negative forms. Basic command help names all-tracked maintenance and no-restack deferral. The old current-stack/candidate-derived maintenance route was replaced with an explicit projected survivor plan: every surviving tracked branch is considered in parent-before-child order, independent roots and local-only branches included. Already-stale bases participate even with no incoming nodes and GitHub disabled. Frozen anchors are named only when maintenance is actually pending, skipped without replay and retained as parents for editable descendants. Already-valid heads are not rewritten. Incoming and cleanup still finish before replay.

`sync_maintenance.ts` exports:

- `planSyncMaintenance(cleanup, context): GetMaintenanceEntry[]`: finite projected surviving graph, known or unknown post-reconciliation heads, effective cleanup parents and bases. Unknown REBASE heads remain unknown until actual application; descendants are selected conservatively.
- `assertSyncMaintenanceAvailable(plan, context)`: existing guarded preflight shared with get (tracked dirt, affected worktrees, replay history/current-tree file collisions).
- `applySyncMaintenance(plan, options, context): string[]`: shared replay engine with `preserveOtherRefs: true` and sync diagnostics. Options retain `shouldRestack`, `updatedBranches`, `onComplete(branch)` and optional `progress`.
- `SyncMaintenanceProgress = { completed: string[], expected: { branchName, head, metadata }[] }`: mutable reached receipts capture actual verified completed replay refs, before the compatible completion callback. Frozen skips do not acquire false replay receipts. This is available for84's final assertions and85's saved phase record.

Shared `applyGetMaintenance` adds optional `operation: 'get' | 'sync'` (get default unchanged), and a same-metadata-except-freeze guard for every pending participant. A real checkout hook changing a pending child's PR title now stops before rewriting that child and retains the concurrent metadata. Get's target-bounded selection is unchanged.

Sync retains the pre-existing legacy cleanup mandatory-participant envelope around replay so hook-time freezing of another mandatory survivor cannot silently become a generic frozen skip. This is not new owned sync recovery.84 must move successful `clearContinuation` after its guarded final completion, wire each maintenance completion callback into `recordSyncCompletionBranch`, and remove the old early raw refresh restoration. Replay itself uses explicit `git rebase <branch>` and needs no global cached-current migration; this slice makes no engine cache changes.

Legacy tests intentionally depending on no replay now explicitly pass no-restack, assert the surviving c head is unchanged, and explicitly select main before inspecting trunk history. The foundation replay test also explicitly selects main for its trunk-history assertion. An old frozen-anchor diagnostic expected a skip for an already-valid anchor; its assertion now requires only the genuinely stale child in Local maintenance, retaining anchor head/metadata and descendant/tree replay checks.

## Red and green evidence

All logs below are in the task root. Dist artifacts were frozen during each reported acceptance run; no tsc emission occurred during the paired checkpoint Node/native runs or the later focused controls. Source/test edits made while a frozen artifact ran did not alter that artifact; their identity differences are recorded below.

1. `83-red-1.log`: initial default independent-root/fanout case failed ancestry with 0 pass/1 fail against starting default false. `83-green-1.log`: same public behavior passed after planner/default implementation, including author/full message/content and no gratuitous second rewrite.
2. Initial late PR-hook attempts (`83-red-metadata.log`, `83-green-metadata.log`) failed because the hook condition incorrectly expected child checkout while the trunk-update cache returned to main; these are not valid preservation proof. Corrected hook includes an independent marker assertion. `83-red-metadata-corrected.log` then observed overwrite/success instead of refusal (0 pass/1 fail) with the guard removed. That deliberate interim mutation build emitted with TS6133 for its unused import; the final restored guard builds cleanly. `83-green-metadata-corrected.log` passed 1/1 and preserves concurrent child title/head.
3. `83-red-conflict.log`: real maintenance-conflict case failed only missing manual phase guidance after asserting reached/pending output. `83-green-conflict.log`: 1/1, preserving rebase-merge, unmerged index and conflict markers, updated trunk and completed parent replay.
4. `83-red-mandatory.log`: existing public pre-rebase hook regression reproduced lost mandatory sibling protection (0 pass/1 fail; first survivor incorrectly replayed and later frozen survivor skipped). Restoring the prior legacy envelope fixes it; final focused frozen run passes that case on both runtimes.
5. `83-controls-1.log`: 3 passing (stale no-restack without incoming, occupied local-only preflight before any incoming/trunk write, frozen anchor + editable descendant + scoped local updateRefs true).
6. `83-controls-2.log`: 1 pass/1 fail, the incoming/local descendant case passed; the boolean/help case had an incorrect punctuation expectation for Pending restack. Its assertion was corrected, no production change; final checkpoint suite passes it.

## Runtime results and identities

Pinned Node `/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node` 24.19.0. Pinned Bun `/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun` 1.3.14. Build `node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json`; native `bun build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile <taskroot>/ticket-83-an`.

Runtime commands ran from `apps/cli`, prefixed by pinned Node; native runs additionally set `ANTHRACITE_TEST_BINARY=<taskroot>/ticket-83-an`. Runner is `../../node_modules/mocha/bin/mocha.js` with the exact file/grep below. These are repeated runtime verifications of the same cases, not additive feature counts.

| Logs | Selection | Node | Native |
| --- | --- | --- | --- |
| `83-{node,native}-final.log` | `dist/test/commands/sync_maintenance_cli.test.js` | 8 passing | 8 passing |
| `83-{node,native}-frozen.log` | `dist/test/commands/frozen_sync_cli.test.js --grep 'checks every mandatory cleanup survivor\|uses an unchanged frozen anchor\|retains optional trunk-stack work\|keeps mandatory cleanup survivors\|skips a newly frozen later generic'` | 5 passing / 1 obsolete diagnostic failure | 5 passing / 1 obsolete diagnostic failure |
| `83-{node,native}-frozen-corrected.log` | same file `--grep 'valid frozen anchor'` | 1 passing | 1 passing |
| `83-{node,native}-get.log` | `dist/test/commands/get_restack_cli.test.js --grep 'independent trunk stack\|reconciled parent\|disabled automatic replay'` | 3 passing | 3 passing |
| `83-{node,native}-authority.log` | `dist/test/commands/sync_authority_cli.test.js --grep 'terminal feature REBASE\|real reconciliation conflict'` | 2 passing | 2 passing |
| `83-{node,native}-legacy.log` | `dist/test/commands/repo/sync.test.js --grep 'foundation\|defer replay'` | BasicScene 3 passing; TrailingProdScene 3 failures | BasicScene 3 passing; TrailingProdScene 3 failures |

Legacy commands additionally set `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME='Sync Test' GIT_AUTHOR_EMAIL=sync@example.test GIT_COMMITTER_NAME='Sync Test' GIT_COMMITTER_EMAIL=sync@example.test`.

The eight-case frozen checkpoint precedes the restored mandatory envelope (its tests use no-delete so that envelope is inapplicable); no broad unchanged eight-case rerun was performed. Checkpoint source manifest `88eeda27e60c4a1ece25d32c185acc3302ea2aa0d4de26d5e424543a6c980166`, compiled JS manifest `7780954f33b6787acaa25ab46b776b1b4a9ef3b4a82a5211a61d599d9747337d`, test manifest `1fbabbfda5f27f4f33b30f56779d7f27c9f5e53db5e1948858c71bb0578efff9`. `ticket-83-source-artifacts-checkpoint.json` SHA256 `083c2142358735e2c928fc474069e2e1a1e7787d9edf064cb4207132b3c20cf9`; preserved `ticket-83-an-checkpoint` SHA256 `c3bc7f46cc73b416798fe4b3f2442ad76baeaffa1d03694daefae4b8484c15b7`.

Final production source manifest `b323cf929e7a95a2bfe41b968b9fa59693945ec36f2ab1667b32dbffdafe6694`; compiled JS manifest `b9fa99f59165844f966b10b6dbf0fec3c0108aeca35920bc466e14e1e3f3082d`; final test manifest `bcb7a4f55ae3449cece6c1a68d6c02c11084d901bd663762413eb38adc87b5d5`. `ticket-83-source-artifacts.json` SHA256 `a4c1f37e30ef4d9598f82a2bc14bd46625419d5c8d9e2f2e34df4732d37e6641`. Final native artifact SHA256 `4179c4186e483f63fd933b646f773e797eac7048be62e4f0811f7b96774a07a2`. Initial final-source frozen run used the old test-only valid-anchor diagnostic; the corrected single case and legacy cases use the final test manifest, same production bytes/native.

Uncached full CLI source ESLint `node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache` and source noEmit `node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit` pass (`83-eslint.log`, `83-noemit.log`). `git diff --check` passes.

## Open compatibility gap and dependent work

The selected legacy run exposed an inherited82 guard mismatch: TrailingProdScene intentionally starts with invalid/dangling metadata `x2`; cleanup plans only valid tracked branches but compares every metadata ref against those branches, classifying existing x2 as newly appeared. All three cases refuse before cleanup writes with `Unexpected branch x2 appeared during cleanup`. This is not passing acceptance. Root and84 were notified; proposed correction is an immutable original snapshot for untouched out-of-graph refs/metadata, while retaining new-participant and late-change guards.84 confirms its final metadata-name guard needs the same baseline. Ownership/final fix remains coordinated with root.

84 owns final physical checkout, actual-deletion fallback receipts and completion, including removal of early refresh restoration.85 owns full fresh-process saved sync phase continuation; the present manual diagnostic deliberately states no saved phase continuation. Generic legacy recovery remains readable.86/87 own later adversarial assembled and installed/npm/MCP acceptance; none is claimed here. No universal freeze-safe/recovery-complete claim is made.
