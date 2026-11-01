# Ticket 79 implementation report

## Delivery and source identity

- Worktree: `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/79`, branch `sync-updates-79`.
- Confirmed clean starting HEAD: `23483b9b4842396a0b96fb15922f6bdd1b436dd8`.
- Implementation commit: `c39dd55f` — `feat(sync): refresh the existing tracked feature graph [skip ci]`.
- Latest integration `04a5c3e413621e8e13f84f875059c235d3c43df0` merged as `1329772cf055954eb8b8ba1cbd496fd0cd1abc23`; preserved ticket81's deleteAll type/option, cleanup-only force OR, tip and tests.
- Fixture correction: `700047956bed4bc3abf0042eec8dafb5b2cbf629` — `test(sync): publish the open empty-branch fixture source [skip ci]`.
- Final CLI source tree: `96ad23b5b8dcfb0dbcdc1a646124394b06ce0662`.
- Full source-file SHA256 manifest and artifact hashes: `ticket-79-source-artifacts.json` outside the repository.
- Final native artifact: `ticket-79-an-merged`, SHA256 `5c4d9479a0afc585421409e50e0a69eb47111822b4f6109288c3beaa2e420a87`. Independently compiled from the worktree's own dist with pinned Bun1.3.14.
- Node runtime: pinned Node24.19.0. Native tests use the same existing Mocha public fixtures via `ANTHRACITE_TEST_BINARY`; no dependency or framework changes.

## Behavior delivered

`sync`, `repo sync` and `repo s` refresh the configured trunk's existing tracked feature graph independently of checkout. Selection resolves stored PR numbers first, validates head name/number/URL/repository and state, distinguishes unassociated absence from lookup failure, retains named local-only work, and excludes closed/merged sources without needing their remote refs. Unassociated old closed same-name PRs do not gain association/cleanup authority. No missing branches or remote-only successors are imported.

The new `sync_refresh.ts` adapter calls the existing graph ordering, pinned source snapshots, guarded update preparation and application boundaries. It supplies explicit `lookupPullRequest` scope `sync` and always passes `force:false` to feature preparation/application. Get retains its original query/default/import/target policy. Existing-parent retargeting and FF/identical updates preserve frozen status and PR details. Explicit no-restack performs no automatic replay; no-pull/no-delete retain their phase exclusions. Successful refresh restores the physical starting checkout through the existing checkout boundary.

Explicitly disabled GitHub integration makes no service/auth requests, explains skipped PR/feature refresh and labels cached state as not freshly verified; legacy trunk/local cleanup/restack remain available. The shared operation guard now runs for sync before ordinary context initialization. Existing tracked-dirt, collision and affected-worktree checks apply before selected writes.

Production files changed: `actions/sync/sync_refresh.ts` (new), `sync.ts`, shared `get.ts`/`remote_update_graph.ts`, `lib/runner.ts`, and both sync route descriptions. Tests reuse `FrozenGetFixture` and the real-Git `FrozenSyncCliFixture`; only external gh boundary fields were extended. The submit fixture retains a real PR tip for closed/merged deleted remote heads, while an absent OPEN source remains a failure.

## TDD receipts and corrections

- `ticket-79-red-1.log`: the first public refresh test failed because sync left the old feature head. `ticket-79-green-1.log`: that same test passed after sharing snapshot/application.
- `ticket-79-red-2.log`: a same-name source from another head repository incorrectly succeeded. `ticket-79-green-2.log`: exact head-repository validation refused it before local head changes.
- `ticket-79-red-3.log`: an unassociated local branch gained a closed same-name PR association. `ticket-79-green-3.log`: the association is now retained only for verified OPEN PRs under the existing rule.
- `ticket-79-expanded-node.log` and `ticket-79-expanded-native.log` retain exploratory failures. The missing-associated-PR test initially lacked an association because get imports do not publish one; it now establishes one through public sync before removing the PR. The disabled-integration setup was corrected from an unsupported flag to the public `--no-enable` form.
- `ticket-79-baseline-node.log`: initial bounded existing frozen/cleanup run reported31 passes and4 failures. Three exposed a real missing `reviewDecision` refresh, fixed by requesting, validating and publishing the field. The fourth fixture declared an OPEN empty PR without publishing its head: it now pushes the actual empty ref to the local bare remote. This does not weaken missing OPEN source refusal.
- An intermediate rerun (`ticket-79-baseline-fixes-node.log`) confirmed the three review-state and three help checks but still used the pre-correction empty-source setup. `ticket-79-empty-node.log`/`ticket-79-empty-native.log` confirm that fixture correction. Raw failed receipts are retained, not called green.

## Historical assertion changes

The three old frozen default-route assertions explicitly said sync never refreshed feature heads. They now assert the intended remote FF, frozen preservation, PR title/body/review-state refresh and real unchanged tree. The help/completion assertions now describe existing tracked feature refresh.

The original test `does not overwrite unrelated saved continuation during zero-replay frozen leaf cleanup` permitted cleanup while a foreign Git rebase/legacy continuation was active. Parent decisions11/13/15 require active/foreign operation protection for expanded sync. The replacement asserts nonzero sync refusal, unchanged leaf/head/recovery/live rebase, then successful explicit legacy `continue` and the original final ancestry check. The adjacent required-replay guard's diagnostic match accepts the earlier shared Git-operation refusal; its preserved-state and successful legacy continuation assertions remain intact.

## Final stable checks

The final source tree and compiled artifacts remain unchanged during these acceptance runs. Per-runtime test identities are the same; repeated runs are not additional feature counts.

| Selection | Node receipt | Native receipt | Result |
| --- | --- | --- | --- |
| New existing-feature refresh suite (26 cases) | `ticket-79-stable-node.log` | `ticket-79-stable-native.log` |26 passing each |
| Ticket81 consent suite (14 cases) | `ticket-79-consent-node.log` | `ticket-79-consent-native.log` |14 passing each |
| Merged B02 force/delete-all traversal plus closed-name association (7 cases; association overlaps new suite) | `ticket-79-merged-node.log` | `ticket-79-merged-native.log` |7 passing each |
| Focused frozen refresh/help/legacy-operation/empty-source guards (9 cases) | `ticket-79-merged-frozen-node.log` | `ticket-79-merged-frozen-native.log` |9 passing each |
| Representative get fanout/scope and completed-publication guards (6 cases) | `ticket-79-merged-get-node.log` | `ticket-79-merged-get-native.log` |6 passing each |

An earlier bounded get graph/publication selection (`ticket-79-get-node.log` / `ticket-79-get-native.log`) covers26 cases. The final merged six-case confirmation uses the final native source artifact, while the earlier native run uses retained `ticket-79-an-final` (hash in the artifact manifest). These are compatibility evidence, not new sync feature counts.

Commands (from the worktree root unless noted):

```sh
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache
/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/ticket-79-an-merged
# Test commands run from apps/cli with pinned Node on PATH.
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_refresh_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_delete_all_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_delete_all_cli.test.js dist/test/commands/sync_cleanup_descendants_cli.test.js dist/test/commands/sync_refresh_cli.test.js --grep 'cleanup-only delete-all|cleanup of descendants|old closed same-name'
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/frozen_sync_cli.test.js --grep 'refreshes frozen feature|explains existing tracked|zero-replay|refuses required cleanup|metadata-only subgroup'
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/get_graph_cli.test.js dist/test/commands/get_publication_cli.test.js --grep 'refreshes the target fanout|does not add an ancestor sibling|committed-hook topology|source cleanup hook'
# Native repeats use:
ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/ticket-79-an-merged node ../../node_modules/mocha/bin/mocha.js <same arguments>
```

Build, noEmit, full-source uncached ESLint and `git diff --check` pass. No an test scope selectors were used. No CI, live GitHub fixture mutation, push, issue/PR update, release, installation or full validation matrix was performed. A sandbox `ps` diagnostic was denied; public test/process supervision continued normally, including real PTY cleanup/legacy controls.

## Pending dependent slices and handoff

This is slice79 plus integrated81, not completion of parent78. Later work still owns trunk/reset preplanning and sync-specific reconciliation guidance80, unified survivor planning82, default restack83, full sync checkout/final-publication verification84, owned sync recovery85, late guards86 and installed guidance/MCP acceptance87. The present adapter intentionally does not add those orchestration states or a generic transaction engine. Its shared noninteractive divergence guidance still follows get wording (including force advice);80 must specialize that text for sync without granting feature overwrite authority. Real interactive reconciliation still follows the existing legacy continuation path until85 adds owned sync intent.

Final clean HEAD is `700047956bed4bc3abf0042eec8dafb5b2cbf629`; current integration `04a5c3e413621e8e13f84f875059c235d3c43df0` is an ancestor. Both stable new-refresh runs returned zero, with26 passing each. Worker worktree retained for the root. Root owns integration/publication and all issue/PR/CI actions.
