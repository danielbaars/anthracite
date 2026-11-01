# Ticket 82 implementation report

## Delivery identity

- Exclusive worktree: `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/82`, branch `sync-updates-82`.
- Clean exact starting integration: `84be5267dee2e379e04d7517b3b831476fbd9084` (79, 80 and 81 integrated).
- Explicit-path staged Anthracite MCP commit: `2b6a62a6dff2ccca2203562db83eaf309821628e`, `feat(sync): plan incoming cleanup and surviving parents together [skip ci]`.
- Anthracite Git passthrough merge of latest `sync-updates`: already up to date at the starting integration.
- Final small compatibility commit: `b128c0edb46e26e0664eed5f35470901a6beaee3`, `fix(sync): retain optional cleanup search progress [skip ci]`, also explicitly staged through Anthracite MCP.
- Final CLI source Git tree: `15b02e89ec7daceae9de903b1f460526ce79dab2`; main implementation checkpoint tree: `7ca89271946ada5d240522ca1826c8814b20c928`.
- `ticket-82-source-artifacts.json` records SHA256 for every production TypeScript source and compiled JavaScript file. Final source manifest SHA256: `386dd181abe4cea5732f0e99bdd205e266282e72a3965411f9f3a47517b2b879`; final compiled JavaScript manifest SHA256: `3afcc4709c4fc7a6ad1e36068070529cc555289f1d5d0d04038122b2d9a6b540`.
- Final independently compiled `ticket-82-an` native artifact SHA256: `a72d4bd394d47db5448c9e2f9de06dda51bf07a22ef8085caf6811a4bca05bd7`.
- Main implementation checkpoint artifact is preserved as `ticket-82-an-2b6a`, SHA256 `5a6ce9438be3f4ab4d74d343bfc0f297f525759df768258e6517bd4b095a552d`. Its `ticket-82-source-artifacts-2b6a.json` records source manifest `3e3a9bc87ad0c01667e52b9d1421f67675de8760776670c1f5dd9ad4644ac2df` and compiled manifest `acb1d450c9ae628912b1b6abdd03e5c6efbf4cf8801d6e838a166b81be0d00c6`.
- Pinned Node 24.19.0 and Bun 1.3.14. No installation/dependency changes.

## Implemented behavior

Sync now prepares its pinned trunk/features and all reconciliation authority, then plans cleanup against the explicit post-incoming graph before applying any local heads. Cleanup uses fresh PR classifications, prospective heads/bases and incoming PR parent changes. Optional cleanup search progress remains available through the existing show-delete-progress flag. Normal closed/merged heads remain excluded from fetching. New OPEN incoming commits cannot inherit deletion authority from an old locally merged tip; an unknown reconciliation result is conservatively ineligible for local-only cleanup classification.

The finite cleanup plan records original heads/metadata, projected parents/heads/bases/freeze/PR metadata, accepted/declined/excluded candidates, ordered deletion names, effective survivor parent publications and mandatory replay closure. Candidate exclusions are recomputed until coherent, including frozen survivors exposed by another exclusion. Known cleanup worktree, replay and checkout-file protections run before incoming application. Consent cancellation abandons the operation before its head changes. No-delete, delete-all/force permission separation, empty-unassociated protection and independent B02 traversal remain.

All incoming updates finish before cleanup. A survivor still naming a removed parent first consumes that exact pinned incoming source; cleanup subsequently publishes its effective local parent without changing its remote PR base or PR identity. No-restack preserves the incoming head/unique work, publishes accepted parent changes and reports pending repair. Frozen incoming parent adoption can remove an old mandatory relationship or introduce a new one; only the resulting cleanup-induced mandatory closure excludes deletion. Separated/fanout cleanup remains deduplicated and parents remain explicit.

Cleanup validates the projected graph and all relevant PR metadata after incoming checkout hooks, then checks expected live refs/metadata and new tracked participants before subsequent writes. A demonstrated checkout-hook PR-title change now stops cleanup while preserving both the actual refreshed head and concurrent metadata; it cannot be overwritten by cached parent publication. Partial errors name reached incoming updates, confirmed physical deletions, completed parent changes, incomplete metadata removal and remaining cleanup. No rollback is claimed.

## Concrete interfaces for 83, 84 and 85

- `sync_refresh.ts`: `SyncRefreshPlan`, `prepareSyncRefresh`, `applySyncRefresh`, `releaseSyncRefresh`. The prepared plan exposes exact pinned nodes/resolutions/PR classifications, optional trunk and original branch/detached checkout. Preparation does not change local heads; application consumes those nodes with feature force:false. Application currently restores checkout using the existing get boundary, and returns confirmed changed names including changed trunk. Source release is explicit, presently called from sync's finally.
- `clean_branches.ts`: `SyncCleanupPlan`, `planSyncCleanup`, `assertSyncCleanupSnapshot`, `assertSyncCleanupAvailable`, `applySyncCleanup`, `SyncCleanupProgress`. `accepted` is bounded allowed cleanup, `deletions` is its finite deepest-first execution order; declined and frozen exclusions are retained. `branches` supplies projected graph and prior snapshots; `parents`, `mandatory`, `replay` name cleanup maintenance. `progress.changed`, `deleted`, `incomplete` are mutable reached-effect receipts consumed by the existing execution path, not a transaction framework.
- `engine.deleteBranch(name, beforeDelete, third)`: old readonly participant arrays remain accepted. The new third-argument object `{ participants, onHeadDeleted }` reports success immediately after the actual `git branch -D` command, before later metadata removal. The callback is threaded to `branch_ops.deleteBranch` through its options object. This distinguishes a physical deletion followed by metadata failure from an absent ref or attempted deletion; only the former enters the confirmed receipt. The public regression rejects metadata removal with a real reference-transaction hook and inspects actual Git refs.
- `getSyncPullRequestInfo` shares precisely the PR publication fields between projected cleanup validation and incoming metadata publication. Existing get callers/selection/recovery are unchanged.

84 should inspect the existing checkout/cache boundary: `finishGetCheckout` switches physical checkout while `engine.currentBranch` retains its cached last refresh checkout. If the original branch is an approved cleanup target, engine deletion can safely refuse because Git still sees that physical checkout. Operation-wide restoration, candidate-original success and confirmed-deletion trunk fallback remain 84, not certified here. Moving final restoration after all phases should address this boundary. Mandatory cleanup preflight includes candidate-parent intermediate checkouts.

83 owns default/repository-wide automatic maintenance; this slice retains the current finishSync legacy restack route while exposing cleanup replay/parents before application. 85 owns durable sync phase persistence, pending PR-status revalidation, pin retention over conflicts and fresh owned continuation. The current finally still releases pins after a real sync conflict, with 80's truthful manual guidance; no owned sync continuation is claimed. 84/86 own assembled final checkout/ref/source-cleanup publication checks. No generic rollback, raw-abort recovery or arbitrary dirty-tree support was added.

## Red/green receipts and qualifications

All tests use public CLI processes, actual temporary Git repositories/bare remotes/worktrees and real hooks/PTYs; only external gh responses are controlled. No private update/replay mocks.

- `82-red-1.log`: exact baseline `84be5267` updates child before later refusing occupied cleanup parent. The initially written fixture mistakenly left its mandatory child frozen (thus excluded cleanup); it was corrected to explicitly unfreeze before the recorded red. `82-green-1.log`: corrected public regression passes after pre-application cleanup preflight.
- `82-baseline-cancellation.log`: the immutable 80 native artifact (`50efcbb7f80d79f6bdcebaa99e3bd462e6a9a82ddb96c3c6241b1ed401c34454`, source described in ticket-80-report) updates child before terminal cleanup cancellation. The final new suite proves unchanged heads on cancellation.
- `82-baseline-retarget.log`: that same baseline already handles the retargeted-frozen-child case because its cleanup runs after refresh. This was a passing compatibility control, not a new baseline failure.
- `82-red-deletion.log`: intermediate 82 implementation reports no confirmed deletion after Git has deleted the branch but metadata removal fails. `82-green-survivors-cycle.log` and final receipts prove the physical-deletion callback correction.
- `82-red-metadata.log`: intermediate 82 implementation accepts a checkout-hook PR-title change, deletes parent and overwrites concurrent PR metadata. Final new suite proves refusal with incoming commits and concurrent metadata retained.
- The two intermediate red artifacts above were isolated `apps/cli/dist82-cycle` builds, not committed source checkpoints and not given immutable manifests before deletion. Their receipts identify the implementation stage and exact commands, not an immutable final-source identity. They are debugging evidence; final acceptance is qualified by the immutable source/artifact manifests above.
- `82-node-compat-initial.log`: initial pre-snapshot/pre-final-guard implementation, 45 passing / 1 failing across refresh26, cleanup6 and permission14. Its occupied mandatory survivor regression under no-restack was fixed by retaining mandatory worktree checks even when replay is deferred. `82-node-survivors-second.log`: newer intermediate implementation, 8 passing (seven then-existing new tests plus the failing mandatory-worktree case). Neither intermediate aggregate is counted as final-source acceptance.
- `82-red-progress.log`: production source exactly at committed checkpoint2b6a fails to display requested cleanup search progress. Final b128 adds the eight-line optional display; the public progress test and other eight survivor cases exercise the final build.
- Initial alternate-outDir command used a test path relative to apps/cli while tsc emitted at worktree root; it reported no test files. Corrected the explicit output directory. The failed command did not execute tests. Own alternate artifacts were later removed.

## Source-qualified frozen acceptance

Each production dist/native build was completed and frozen before its acceptance runs. The 28+8 selections below exercised main implementation checkpoint `2b6a62a6`. Only after all four processes exited 0 and the manifests were verified did the small optional-progress red/green cycle start. Its final commit `b128c0ed` adds eight production lines for optional percentage output and one public test, without changing the other behavior. The final nine-case survivor suite is run again on both final artifacts; the earlier 28+8 receipts retain their checkpoint identity and are not relabeled as runs of the later commit. NoEmit/ESLint and Git commits do not rewrite dist. Initial compatibility used original dist while vertical cycles emitted only to a separate output directory; no active-tree emit occurred.

| Selection | Node receipt | Native receipt | Result |
| --- | --- | --- | --- |
| Checkpoint2b6a: new survivor cases8, existing cleanup descendants6, cleanup consent14 | `82-node-final.log` | `82-native-final.log` | 28 passing each |
| Checkpoint2b6a: pinned trunk, three terminal feature choices, real sync conflict, two shared get reconciliation boundaries, GitHub-disabled flow | `82-node-authority-get.log` | `82-native-authority-get.log` | 8 passing each |
| Final b128: survivor cases including restored optional progress | `82-node-progress-final.log` | `82-native-progress-final.log` | 9 passing each |

Final noEmit, full-source uncached ESLint and git diff --check pass. These are focused local checks, not CI/full-matrix or assembled 78 acceptance. Repeated runtimes cover the same scenarios, not additional feature identities.

Exact commands, from worktree root unless indicated:

```sh
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache
/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/ticket-82-an
# Cycle build, only when no cycle test was active:
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --outDir apps/cli/dist82-cycle
# From apps/cli with pinned Node on PATH:
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_survivor_cli.test.js dist/test/commands/sync_cleanup_descendants_cli.test.js dist/test/commands/sync_delete_all_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_authority_cli.test.js dist/test/commands/get_reconciliation_cli.test.js dist/test/commands/sync_refresh_cli.test.js --grep 'pinned trunk source|terminal feature|real reconciliation conflict|unique local commits|old parent commits|GitHub integration is explicitly disabled'
# Native repeats set:
# ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/ticket-82-an
# Baseline cancellation/retarget controls set ticket-80-an and select the relevant test with --grep.
```

No push, GitHub/CI changes, live fixtures, full suite, release, installation or dependency mutation. Root owns integration and publication.

The final narrow compatibility command, from apps/cli with pinned Node on PATH, is `node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_survivor_cli.test.js`; the native repeat uses final ticket-82-an. Red progress used the alternate dist82-cycle test file with `--grep 'optional progress'` before the production fix.

Final clean handoff at `b128c0edb46e26e0664eed5f35470901a6beaee3`: final nine-case Node/native processes both exited 0, final noEmit/ESLint exited 0, final source/compiled/native hashes still exactly match the final manifest, git status --short is empty, git diff --check is clean and latest sync-updates is an ancestor. Own alternate build directories were removed. Main checkpoint28+8 and final9 receipts retain their distinct source identities; no extra broad rerun was performed after the eight-line optional logging fix. No required processes remain running.
