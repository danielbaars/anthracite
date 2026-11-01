# Ticket 80 implementation report

## Source and delivery identity

- Exclusive worktree: `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/80`, branch `sync-updates-80`.
- Starting integration: `f0506fd8048e365a6f03be2fc7a266ec4ba85f41` (79 and 81 integrated).
- Authorized checkpoint, created with explicit staged paths and Anthracite MCP `modify --commit`: `b4f7fed6fddf27df65b3b0e9054a387b36f6aa81`, `feat(sync): separate planned trunk and feature authority [skip ci]`.
- Latest `sync-updates` merged with Anthracite Git passthrough: already up to date at `f0506fd8048e365a6f03be2fc7a266ec4ba85f41`.
- CLI source tree: `0d9eadda0b643ea8a895c99acfb5eda7a1d44b13`.
- Complete source/compiled-JavaScript file manifests and new test hashes: `ticket-80-source-artifacts.json` outside the repository. Source manifest SHA256: `bae0efec539f8c1f5e08a26e988f4ea4d10fb6b59dabb5ea55ccff906bf45de1`. Compiled source JavaScript manifest SHA256: `8b47c819a155a74772b718cc15c3b33b1071ecaa5b2b7d1041a119e80fbde011`.
- Independently compiled native artifact: `ticket-80-an`, SHA256 `50efcbb7f80d79f6bdcebaa99e3bd462e6a9a82ddb96c3c6241b1ed401c34454`.
- Pinned Node 24.19.0 and Bun 1.3.14; no dependency/framework additions or installation mutations. Native runs use the same public Mocha fixtures through `ANTHRACITE_TEST_BINARY`.

## Implemented behavior

Sync now snapshots optional trunk and all selected feature sources before application, collects feature reconciliation and trunk reset decisions, then applies trunk before parent-first feature updates. A refused trunk decision or divergent feature decision does not apply another planned head. No-pull entirely omits trunk fetching, application and reset while retaining feature refresh, including when force is supplied and the remote trunk is missing.

Identical/FF trunk uses the guarded shared application boundary. Local-ahead/divergent trunk requires explicit sync force or affirmative real terminal reset consent. Cleanup-only delete-all never grants reset. Sources are pinned individually; trunk reset uses its original authorized remote OID after all feature fetches, never mutable FETCH_HEAD. Trunk pins/local head and affected worktree availability are checked again around original checkout hooks. Physical checkout/head checks prevent a hook-selected unrelated checkout from becoming a hard-reset target. Tracked staged/unstaged bytes and ignored/untracked collisions remain protected despite force. Successful refresh restores the original checkout through the existing boundary.

Feature preparation/application always receive force:false. Sync-specific noninteractive diagnostics no longer recommend force for feature overwrite; terminal rebase, overwrite and abort remain explicit, with no frozen local-rebase choice. Existing identical/FF valid tracked-parent adoption, former-parent retention, frozen state and PR identity behavior from 79 remain. Get keeps target/import/scope behavior and FF-only trunk even with force. Its strict saved trunk representation does not acquire a sync reset field.

A real sync reconciliation conflict keeps the actual Git rebase, index and conflict bytes. This slice explicitly reports that it has no saved sync phase continuation yet; it does not create an unbound legacy queue or advertise full `an continue` phase replay. Confirmed earlier trunk/feature changes are named and are not rolled back. Ticket 85 supplies durable sync-owned resumption later.

## Shared reconciliation correction

The first real PTY rebase test exposed an existing shared correctness bug: when both published parent and child had advanced, replay from the old parent revision attempted to reapply the child's already-published commit, producing an avoidable conflict. The same public get scenario reproduced it. The final minimal engine correction derives replay start from the shared ancestor of the guarded cached local head and pinned incoming head, but never moves it before the original parent revision. This replays unique local work without replaying old parent history. Source-less legacy replay keeps its prior boundary. Parent metadata base and continuation formats are unchanged; no new source/saved schema, flag or parallel replay engine was introduced.

New get regression verifies one surviving unique commit, complete subject/body/trailer, author/name/email, ancestry, remote parent/child bytes and local file bytes. A separate rewritten-parent guard proves an old parent commit/file is not replayed when the shared source ancestor predates that parent boundary. Existing get reconciliation/restack, saved no-restack continuation, graph scope and final publication guards were also exercised.

## Material compatibility distinction for ticket 87

Legacy sync treated local-ahead trunk as a successful no-op, including with force. This implementation deliberately follows normative decision 5 and ticket 80: local-ahead now refuses without reset authority, and explicit force/affirmative terminal consent can reset it to the pinned remote trunk. Do not describe this as unchanged legacy execution or claim the historical local-ahead baseline reset. Root explicitly resolved this interpretation before implementation. Existing scripts using force only to avoid cleanup prompts should migrate to delete-all for narrow cleanup consent; no-delete retains precedence. Full public documentation/help/completion alignment belongs to 87, including this local-ahead disclosure.

## TDD and failed receipts

- `80-red-1.log`: public sync changed planned feature heads before later refusing divergent trunk. `80-green-1.log`: same test passes after combined trunk/feature planning and trunk-first application. An intermediate attempt exposed get's strict saved-trunk schema rejecting a newly serialized false reset field; final get snapshots omit that sync-only property.
- `80-red-2.log`: shared get wording incorrectly offered force overwrite for sync divergence. Final `80-node-final.log` / `80-native-final.log` and `80-green-2-3-4.log` verify truthful sync wording and preservation.
- `80-red-3.log`: sync conflict output advertised legacy continuation instead of the actual incomplete phase boundary. Final real-conflict tests verify retained Git HEAD/conflict/index and truthful manual guidance.
- `80-node-authority.log`: exploratory 17 pass/1 fail; real terminal REBASE exposed replaying a previously published child commit. `80-red-get-replay.log` independently reproduces the same shared bug through public get. `80-green-2-3-4.log` retains an intermediate sync-only replay prototype; that prototype was replaced by the final shared bounded correction and is not final-source acceptance.
- `80-node-get.log` / `80-native-get.log`: 10 pass/1 fail each. The extra rewritten-parent guard supplied only one response despite two legitimate terminal decisions (frozen parent overwrite, then editable child rebase), so it timed out at the second prompt. Corrected only that fixture's two explicit responses; `80-node-parent-boundary.log` / `80-native-parent-boundary.log` show the same failed case passing on the unchanged final source. Raw timeout transcripts remain preserved.

## Final same-source verification

Repeated scenarios are the same identities across runtimes, not extra feature counts. Production source and the independently compiled native artifact stayed unchanged during these runs. Later edits corrected/added test inputs, with successful TypeScript builds. Those test-only tsc builds also rewrote identical production JavaScript while some Node suites were active; this creates a possible partial-write race even though final compiled contents/hashes stayed identical and no partial-read failure was observed. No further emits occurred after that was identified; the corrected-parent and quiet targeted receipts ran after their respective emits. Treat Node evidence with that runtime qualification, rather than claiming its artifact files were never rewritten.

| Selection | Node receipt | Native receipt | Result |
| --- | --- | --- | --- |
| 22 new sync authority cases + initial get shared-replay regression | `80-node-final.log` | `80-native-final.log` | 23 passing each |
| Quiet forced feature refusal before planned trunk FF | `80-node-quiet.log` | `80-native-quiet.log` | 1 passing each |
| Corrected rewritten-parent boundary guard | `80-node-parent-boundary.log` | `80-native-parent-boundary.log` | 1 passing each |
| New get replay plus existing reconciliation/continuation/scope/publication guards | `80-node-get.log` | `80-native-get.log` | 10 passing each; only failed fixture separately corrected above |
| Complete 79 refresh + 81 cleanup-consent + get trunk/parent selection | `80-node-compat.log` | `80-native-compat.log` | 61 passing each (26 refresh + 14 consent + 21 get trunk/parent) |

Build, noEmit (`80-noemit.log`), full-source uncached ESLint (`80-eslint.log`) and `git diff --check` pass. No an test scope flags were used. All tests exercise public CLI processes with real Git repositories/bare remotes and real terminal prompts/hooks; only the external gh service boundary is controlled. No live GitHub fixtures, CI/full matrix, push, PR/issue mutation, release, installation or dependency mutation was performed.

Commands (worktree root unless stated):

```sh
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache
/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/ticket-80-an
# From apps/cli, with pinned Node on PATH:
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_authority_cli.test.js dist/test/commands/get_reconciliation_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_authority_cli.test.js --grep 'quiet forced feature divergence'
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/get_reconciliation_cli.test.js --grep 'old parent commits'
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_refresh_cli.test.js dist/test/commands/sync_delete_all_cli.test.js dist/test/commands/get_trunk_parent_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/get_reconciliation_cli.test.js dist/test/commands/get_restack_cli.test.js dist/test/commands/get_recovery_cli.test.js dist/test/commands/get_graph_cli.test.js dist/test/commands/get_publication_cli.test.js --grep 'unique local commits|old parent commits|maintains descendants on the resulting|keeps explicit reconciliation permission|keeps saved no-restack authority|refreshes the target fanout|does not add an ancestor sibling|committed-hook topology|source cleanup hook'
# Native repeats use ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/ticket-80-an.
```

The initial 23-case final receipt preceded adding the separate quiet case and rewritten-parent test; the later targeted receipts cover those additions. The immutable native and final source hashes above qualify the final acceptance receipts; Node compilation timing is qualified above. This is not a claim that the current expanded two-file suite was run as one new aggregate count.

## Pending dependent boundaries

This completes ticket 80's trunk/reconciliation slice, not parent 78. Cleanup still uses the legacy separately authorized phase after incoming application; ticket 82 integrates all cleanup/survivor choices into the bounded plan. Default automatic restack remains for 83, final operation-wide checkout/publication/source-cleanup invariants for 84, durable sync-owned conflict continuation for 85, assembled late guards for 86, and complete public documentation/installed-package/MCP acceptance for 87. No universal rollback or arbitrary dirty-tree support is introduced. The existing get completion safeguards remain covered; this slice does not certify unimplemented full-sync completion/recovery behavior.

Final handoff confirmed at `b4f7fed6fddf27df65b3b0e9054a387b36f6aa81`: `git status --short` empty; latest `sync-updates` is an ancestor; `git diff --check` clean. Both final compatibility processes exited 0 with 61 passing each. The compiled source JavaScript contents still exactly match the manifest after the last emit. No required checks remain running. Root owns integration and all publication.
