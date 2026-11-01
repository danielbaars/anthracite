# Ticket 84 implementation report

Final clean handoff: `0f11e47e2689b3a4ffab53045e2b2da0257ae8d8`, containing current `sync-updates` integration `82707575eb04f1b8ef5b11720ad23b5fbddc9538` (79–83). Final integrated source tree `60a2f35766d24977d9bb68ed086638675e4af4d1`. Assembled bounded checks: **33 passing per runtime** (26 completion/maintenance +7 isolated legacy/mandatory), full source uncached ESLint and noEmit pass. No active runs or worktree changes remain. The independent 46-case checkpoint below is retained separately and is not the final assembled source acceptance.

## Independent #84 checkpoint identity

- Exclusive worktree: `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/84`, branch `sync-updates-84`.
- Exact clean starting integration: `5876b761ef4a2b3428ae38e1ff14653a6b7a22d9` (79–82 integrated).
- Explicit-path staged Anthracite MCP commit: `a9c0e6896e76c292422f41cbe7d9fec898b7e6e3`, `fix(sync): restore checkout and guard final completion [skip ci]`.
- CLI source tree: `d5235e00b244e2c7b13afac6aa9ed307e0868efb`.
- Anthracite Git passthrough merge of current `sync-updates` at `5876b761`: already up to date. Working tree clean at this checkpoint.
- Pinned Node24.19.0 and Bun1.3.14, no dependency or installation changes.
- Frozen checkpoint `ticket-84-source-artifacts.json`: complete production TypeScript and compiled JavaScript SHA256 maps; source manifest `35bca030353789d03e5e3798a89885808697c87935b72888eb540de545979c57`, compiled manifest `027081fa507e5c6eb57fff0e829680e49aba88dafa3a94a18b396fba8f15aca9` (each manifest is SHA256 of sorted-key JSON for the respective map).
- Independently compiled `ticket-84-an`: SHA256 `1bf9e0c957eef6b1e1221172ab2f2dd13538237f095c6115970f399accf37ffe`.
- Production emits ended before final Node/native runs; no production artifact is rewritten during those runs. Earlier exploratory controls are source-qualified interim observations, not immutable-final-artifact evidence.

## Implemented behavior and files

`sync_refresh.ts` captures the original physical branch/detached identity plus original physical head and configured trunk head before intermediate work. It no longer restores the original checkout between incoming updates and cleanup: approved order is incoming → cleanup → maintenance → final checkout.

`sync_completion.ts` supplies the single checked completion boundary. After cleanup's terminal guarded check, it records exact reached authorized heads/metadata, prepared trunk head, initial untracked original head, and absent refs/metadata for confirmed physical deletions. Maintenance can update only its own completed entry after its bounded publication guards. Completion checks the expected graph, restores the original branch at its current authorized head or exact detached OID, then verifies graph and physical identity after checkout hooks. It checks pinned source identities, performs owned source cleanup, and checks graph/checkout again. Head, topology, PR metadata, unexpected tracked participants and restored deleted refs cannot pass; independently permitted freeze-only changes remain preserved.

Only `progress.deleted` receipts from82's `engine.deleteBranch` onHeadDeleted callback authorize original→trunk fallback. Selection, attempted deletion or missing refs do not. Failure preserves actual checkout, actor metadata/refs and reached work, returns nonzero with reached updates/deletions/parent changes and manual inspection guidance. Source-ref guidance remains neutral when some refs may already have been removed. Once application starts, failed completion no longer blindly releases remaining sources in a finally block.

`engine.ts` refreshes physical current identity only in the bounded cleanup callback-object path before deleting a physically checked-out candidate. Its existing logical recovery-current semantics and ordinary delete callers remain unchanged; it uses the existing preserveIgnored switching protection.

`get_checkout.ts` retains default get behavior and adds an optional third operation label, so sync's reused checkout diagnostics say `before sync stopped` while unchanged get callers still say `before get stopped`.

`sync.ts` at the initial `a9c0e689` checkpoint wires no-replay completion independently of default-maintenance work #83. That checkpoint retains the previous maintenance implementation until83 reconciliation; its actual replay progress must use `recordSyncCompletionBranch` after integration. No85-owned continuation is preimplemented here.

## Public tests and red/green evidence

Approved seam: public CLI processes, real temporary Git repositories/bare remote/worktrees, real Git hooks; controlled external gh responses only. No internal engine, fetch, replay or recovery mocks.

- `84-red-fallback.log`: original child was actually deleted but sync ended on parent, not declared trunk; 0 passing/1 failing. `84-green-fallback.log`: 1 passing.
- Red fallback production source was the exact starting source tree `15b02e89ec7daceae9de903b1f460526ce79dab2`. For the subsequent source-hook red, only the minimal fallback implementation in `sync.ts` differed; `84-red-source-sync.ts` reconstructs those exact bytes from the recorded edit, SHA256 `a4a360057bda421532b8e319aeb458dea779e1808757e2607e83420b5f108309`. This reconstruction is identified as retrospective; early compiled artifacts were overwritten by later builds and are not claimed immutable.
- `84-red-source.log`: real source-ref deletion hook changed surviving PR metadata; old sync returned status0 instead of nonzero, 0 passing/1 failing. `84-green-source.log`: both fallback and source-hook refusal pass.
- `84-node-initial.log`: nine expanded public controls passing on the source-qualified interim compiled artifact.
- `84-node-final-controls.log`: four focused final physical/occupancy/head/disappearance controls passing after final wording/control additions (one disappearance control repeated; not additional unique coverage).
- Twelve distinct tests in `sync_completion_cli.test.ts`: confirmed deletion fallback, source-cleanup PR mutation, surviving original current authorized head, exact detached restoration, final checkout PR mutation with reached cleanup retained, source-cleanup head mutation, source-cleanup physical change, permitted final freeze delta, unexpected original disappearance, final physical redirect, late original occupancy and final surviving-head mutation.

The82 survivor test formerly named `preserves concurrent PR metadata from a checkout hook and refuses stale cleanup` relied on early restoration to main before cleanup. With normative final phase order, that same main checkout hook fires after authorized cleanup. It is now named `preserves final checkout hook PR metadata and reports reached cleanup`, asserts removed parent remains removed, actor PR/topology bytes remain intact, incoming head remains reached, and reports nonzero/final failure/confirmed deletion.82 historical red/green evidence is unchanged. Other existing incoming/cleanup/publication guards remain in place.

## Checks and exact commands

Pinned paths:

- Node: `/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node`.
- Bun: `/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun`.

Build from worktree: `node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json`.

Native: `bun build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/ticket-84-an`.

Full source uncached ESLint: `node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache`, pass; `84-eslint.log` empty.

Typecheck: `node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit`, pass; `84-noemit.log` empty.

Frozen bounded runtime command from `apps/cli`: `node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_completion_cli.test.js dist/test/commands/sync_survivor_cli.test.js dist/test/commands/get_checkout_cli.test.js dist/test/commands/get_publication_cli.test.js`. Native uses the same exact files with `ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/ticket-84-an`.

Final frozen results at `a9c0e689`: Node **46 passing (8m)**; native **46 passing (7m)**. Each runtime contains the same 12 new completion, 9 survivor, 16 get checkout and 9 get publication controls. Logs: `84-node-final.log`, `84-native-final.log`. Post-run verification confirmed every production source/compiled file and native SHA256 unchanged. This is 46 distinct scenarios, not 92 unique cases.

Historical integration finding from83 after these runs: a legacy fixture intentionally retains invalid out-of-graph metadata x2 after raw parent deletion.82 currently excludes it from plan.branches then rejects it as newly appeared;84's final name guard would do the same. It needs an immutable pre-application out-of-graph baseline shared by cleanup and completion, preserving untouched invalid metadata while detecting additions/mutations. Root assigned84 the bounded shared fix, now implemented in `c232495d` and merged with83 in `0f11e47e`; the final integrated runtime checks below verify the actual correction.

## Interfaces for 83 and 85

- `SyncRefreshPlan` now also supplies `originalHead`, `trunkHead` (the optional pinned trunk itself supplies its authorized final head).
- After guarded cleanup: `const completion = createSyncCompletion({ refresh, cleanup, progress }, context)`.
- After each maintenance branch's validated completion: `recordSyncCompletionBranch(completion, branch)`;83's onComplete callback is the intended seam.
- Final boundary: `finishSyncCompletion(completion, { updated, deleted: progress.deleted, changedParents: progress.changed, releaseSources: () => releaseSyncRefresh(refresh) }, context)`.
- `SyncCompletion` is plain serializable `{checkout,untouched,expected,sources}`; expected entries are `{branchName,head,metadata}` with raw expected metadata object OIDs and empty refs for confirmed deletion.
- `assertSyncCompletionGraph(completion)` is exported for bounded operation guards.
-85 should reuse the boundary with its persisted exact expected state and ownership guards, and clear owned continuation only after both post-hook completion checks succeed. Existing mandatory legacy continuation envelope must likewise not be cleared merely because maintenance finished before final checkout/source cleanup checks.

## Limits and boundaries

No full suite/matrix, CI, live GitHub fixture writes, pushes, PR, releases, npm packaging, owner installation or new dependencies. No rollback/retry/generic transaction engine, expanded dirty support or85 continuation is implemented. Existing get final checkout/publication compatibility is in the selected runtime check, not claimed from historical totals. Final assembled default-maintenance/continuation/adversarial/npm/MCP acceptance remains83/85/86/87 work. Root owns the single PR and remote publication.


## Authored integration corrections and final checkpoint

- Correction commit `c232495d`: `fix(sync): preserve opaque refs and verify cleanup publication [skip ci]`, explicit staged An MCP.
- Merge current integration `82707575eb04f1b8ef5b11720ad23b5fbddc9538` (83) into84: `0f11e47e2689b3a4ffab53045e2b2da0257ae8d8`, `Merge sync-updates into sync-updates-84 [skip ci]`, An Git merge/continuation. Shared sync.ts conflict resolved with83's maintenance plan/preflight and84's checked completion callback. Only the task-owned clone temporarily configured a noninteractive merge editor; it was restored to its original unset value.
- Integrated CLI source tree `60a2f35766d24977d9bb68ed086638675e4af4d1`.
- Integrated frozen artifact `ticket-84-source-artifacts-integrated.json`: source manifest `e4cea7fe2ef10c43f97d0debbc6c8d765b91e00942c6580bea729ba5acc4dbce`, compiled production manifest `ef98098e1090567917598cec76723937c1d481040b0133dc7da968adeb7a7915`, test-source manifest `681606988262d15ef23dc76400e540cfa398933217f0b5530bd9223cecebd340`, compiled test manifest `acbceb5ed6dfbd5a16e2d03284a629bf916330d09791db761272793ffe55d23c`.
- Separately preserved integrated native `ticket-84-an-integrated`, SHA256 `3596bfc4b29b68393001fefcd9d6874652fb6200de1e71547e12cf93b1849cdb`. The original ticket-84-an remains unchanged as the46-case checkpoint artifact. Original compiled dist was rebuilt only after both original runtime runs completed and their byte verification was recorded.

### Untouched opaque baseline

`SyncCleanupPlan.untouched` is immutable `readonly {branchName,head,metadata}[]`, captured with raw Git OIDs BEFORE application. Existing metadata outside the valid tracked graph is preserved without parsing, repairing, importing or normalizing it. Snapshot guards, cleanup guards and final completion reject actor head/metadata changes and newly added participants. A retained configured-trunk metadata ref also keeps its opaque metadata while its head follows the separately authorized prepared trunk update; it is not pinned to its previous head accidentally.

`SyncCompletion` additionally persists `untouched: readonly string[]`. Final comparison for these names uses exact raw metadata OID equality, never the tracked participants' freeze comparison/parser. `recordSyncCompletionBranch` refuses these names, so callbacks cannot bring untouched refs into replay scope. Valid tracked branches still permit their existing independently allowed freeze-only deltas.

- `84-red-untouched.log`: unchanged invalid child parent metadata refused as Unexpected branch child, 0 pass/1 fail at original production checkpoint.
- `84-green-untouched.log`: minimal unchanged-baseline scenario1 pass.
- `84-node-untouched.log`: four controls pass for preservation, final actor head mutation, pre-cleanup opaque actor metadata mutation and a genuinely new final participant.
- `84-red-opaque-freeze.log`: initial broad freeze-comparison policy incorrectly accepted a changed field on untouched metadata, status0; 0 pass/1 fail.
- `84-green-publication-opaque.log`: strict opaque comparison and cleanup publication controls2 pass.
-83's inherited TrailingProdScene3 failures on both runtimes remain historical failures in its report/logs. The integrated legacy selection below verifies the actual correction rather than reclassifying those failures.

### Intended cleanup publication

Root identified a concrete candidate where actual readback could bless an actor's replaced parent metadata. `84-red-cleanup-publication.log` proves it publicly: committed reference hook restores child's original parent blob after owner publishes parent=main; old path logged parent publication, deleted parent and returned0, leaving the child's old topology. This was 0 pass/1 fail.

The bounded fix exposes `engine.setParent`'s existing intended publication metadata OID as `string | undefined` (undefined for an existing no-op). Every12 source caller was inspected and existing callers ignore the return. Cleanup validates unchanged expected head and intended metadata OID after hooks, before advancing verified expected/progress receipts or proceeding to deletion. It never derives expected publication from actor readback. The green control preserves actor's old metadata and both original heads, refuses deletion and reports retained reached work/manual inspection. No rollback or transaction is added.

### Assembled progress and completion

The final orchestrator plans/preflights83 maintenance before incoming changes, applies refresh and guarded cleanup, creates completion state, retains the legacy mandatory cleanup-participant envelope, records each83 verified replay's actual authorized head/metadata via `recordSyncCompletionBranch`, and calls the same checked completion boundary. Legacy mandatory continuation is cleared only AFTER final checkout/source cleanup graph checks succeed.85 must retain that order for owned sync continuation.

### Integrated bounded verification

All production emits and native compilation finished before these frozen runs started. Exact commands from apps/cli use pinned Node and the native environment override pointing to ticket-84-an-integrated.

- `mocha dist/test/commands/sync_completion_cli.test.js dist/test/commands/sync_maintenance_cli.test.js` → logs `84-{node,native}-integrated.log`; **26 passing on Node (5m), 26 passing on native (4m)**: 18 completion +8 maintenance cases.
- Historical first legacy invocation `mocha dist/test/commands/repo/sync.test.js --grep 'foundation|defer replay'` → logs `84-{node,native}-legacy.log`;2 pass/4 fail per runtime because the runner omitted required global Git isolation. Raw fixture fake squash rebases inherited owner's global rebase.updateRefs=true, explicitly rewrote b and invalidated its metadata before CLI. This is not counted as passing product acceptance. The corrected frozen rerun below isolates globals; explicit local updateRefs=true maintenance protection remains tested unchanged.
- Corrected exact isolated selection: `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 mocha dist/test/commands/repo/sync.test.js dist/test/commands/frozen_sync_cli.test.js --grep 'foundation|defer replay|checks every mandatory cleanup survivor'` → `84-{node,native}-legacy-isolated.log`: **7 passing per runtime** (6 Basic/Trailing legacy cases, including all formerly failing Trailing cases, plus mandatory pre-rebase freeze guard). Native additionally sets ANTHRACITE_TEST_BINARY to the integrated native path.
- Full source uncached ESLint and noEmit restarted for the integrated source, logs `84-eslint-integrated.log`, `84-noemit-integrated.log`; **both pass**, logs empty.

Post-run `84-integrated-frozen-verification.log` confirms all production TypeScript, compiled production JavaScript, test sources, compiled test files, integrated native and original checkpoint native unchanged. Integrated manifest file SHA256 `bec78d89a347e498de1452f94682d75a2b18427b397a04214467223a1ab8bc73`. No emits occurred during any integrated runtime runs. Git diff-check passed; worktree clean; current sync-updates ancestry verified.

Final 33 per runtime are the same33 distinct scenarios repeated on two runtimes, not 66 new cases. The earlier 46 checkpoint includes repeated completion controls and different selected get compatibility tests and is kept source-qualified; do not add these counts as new feature coverage. No unresolved acceptance failure remains in the bounded selections. Owned sync continuation #85, broader adversarial #86 and final #87 acceptance remain explicitly outside this ticket.

No CI/full matrix/live/GitHub write/push/package/install or85 work occurred.
