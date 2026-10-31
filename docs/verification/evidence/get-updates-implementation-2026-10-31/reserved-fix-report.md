# Integration review fixes — first pass

## Scope and provenance

Exclusive worktree: `/private/tmp/anthracite-get-updates-implementation-20261031/worktrees/review-fixes`, branch `get-updates-review-fixes`. Initial HEAD verified exactly as integration `321e81e7704ba88e0837ce458448ada50180b611` with a clean working tree. Read approved task instructions/specification, final #75 report, root's review candidates/probe and TDD guidance. Reused the approved public CLI / real Git and bare remotes / controlled gh seam; no implementation mocks, new dependencies, CI, live fixture writes or user-installation changes.

This first pass fixes the assembled future-import regression and committed metadata-publication finding, with the two bounded reporting corrections. The same worker/worktree is reserved for any later independent review findings. Final runtime results are recorded below; commit and handoff are appended after explicit staging.

## Corrections

1. An unchanged future import is not a freshly unfrozen local anchor. The get hook guard now distinguishes a saved `wasTracked=false` import with the exact original head and absent original/current metadata, still pending remote application. Its queued ownership decision remains authoritative. Once a head/metadata changes concurrently or the import is actually applied, ordinary frozen/head/topology guards remain in force. Existing repeated queued and mixed-ownership conflicts must still complete through fresh continue/cont without new service lookup.
2. Metadata publication now returns its intended object OID, allowing graph get to verify actual head plus the complete intended metadata after the write's hooks. The comparison still permits only freeze-status differences. Force/import and FF/adoption check before returning phase completion; get-owned replay and continuation check after metadata publication and again after return checkout. Concurrent topology/base/PR/head state and reached commits remain intact, with the branch pending/manual rather than falsely completed/cleaned. Legacy and sync callers retain their defaults; no general transaction or rollback framework was added.
3. Failure guidance requires the fresh matching owned envelope, repository/rebase/source identity and expected head/topology state. Diagnostics deliberately skip transient freeze/worktree/file protection checks when deciding whether the existing bound conflict can resume after that blocker is cleared. Changed intent/legacy mirrors with the old marker gives manual guidance. A late worktree control now explicitly clears the blocker and proves continuation still succeeds while the other worktree's edited file survives.
4. Source-ref diagnostics use neutral `Get source refs for inspection` wording because cleanup can already have removed some refs before a later failure. Human phase labels (`trunk fast-forward`, `remote refresh`, `local maintenance`, `final checkout`) are restored without changing persisted phase values.

The existing concurrent-tracking import test is intentionally a refusal/preservation control now. A separately published tracked tip changes the saved immutable plan; continuation cannot collect a new overwrite choice or adopt its state. The case uses real external Git ref/metadata publication, preserves the editable status/unique content/head/metadata and index/recovery, and verifies no gh call. The four ordinary queued/mixed controls keep their full successful continuation expectations. Root authorized this scope and WT76 left the case untouched.

Changed production paths: `actions/sync/get_recovery.ts`, `lib/engine/engine.ts`, `lib/engine/metadata_ref.ts`. Tests: new `get_publication_cli.test.ts` (five public cases), the concurrent-tracking case in `get_import_defaults_cli.test.ts`, and the recoverability extension in `get_late_guards_cli.test.ts`.

## Red/green evidence

- `review-fixes-red-import.json`: existing public queued-import case refused before `Hit conflict` (0 passing / 1 failing). `review-fixes-green-import.json`: same existing case passed after the narrow future-import check.
- `review-fixes-red-publication.json`: real reference-transaction **committed** hook restores former child metadata after a declared parent transition; get returned 0 (expected 1). `review-fixes-green-publication.json`: now refuses while preserving the incoming head and exact hook-written metadata.
- `review-fixes-red-guidance.json`: an original reference hook changes the saved envelope while the old active token remains; refusal incorrectly recommended continue instead of manual inspection. `review-fixes-green-guidance.json` passes the corrected guidance and concurrent actor-preservation controls (2/2).
- `review-fixes-publication-node-initial.json`: four publication cases passed; the actor-preservation test initially compared against fixture.oldChild instead of the actual actor head containing its local-only commit. The test now independently captures and preserves that actual head and content. No production behavior was changed to satisfy the mistaken fixture expectation.
- `review-fixes-temporary-guard.json`: the extended late occupancy case passes, including valid continuation guidance and successful completion after freeing the pending branch, preserving the detached other worktree's edited file.

## Commands and exact-source validation

All commands use pinned Node 24.19.0 first in PATH, in the review-fixes worktree:

```sh
node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json
node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts
node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit
git diff --check
```

Compilation, full CLI source lint, no-emit and whitespace checks passed before final runtime runs.

```sh
/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun build --compile apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-get-updates-implementation-20261031/review-fixes-an
```

Final focused command, first Node and then with `ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-get-updates-implementation-20261031/review-fixes-an`:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node node_modules/mocha/bin/mocha.js apps/cli/dist/test/commands/get_publication_cli.test.js apps/cli/dist/test/commands/get_late_guards_cli.test.js apps/cli/dist/test/commands/get_frozen_cli.test.js apps/cli/dist/test/commands/get_import_defaults_cli.test.js apps/cli/dist/test/commands/get_recovery_cli.test.js apps/cli/dist/test/commands/get_trunk_parent_cli.test.js apps/cli/dist/test/commands/stack/restack_continue.test.js apps/cli/dist/test/commands/repo/sync_continue.test.js --grep 'get CLI completed publication guards|get CLI late participant guards|preserves a queued import through|retains mixed queued|newly tracked by another process|retains a fresh freeze|resumes fanout from pinned|newly frozen pending replay|reports reached trunk|reports a reached trunk|single merge conflict|Can continue a repo sync with one merge conflict' --reporter json
```

Receipts: `review-fixes-node-final.json`, `review-fixes-native-final.json`. Node: **35 passing / 0 failing**, 370.985 seconds. Native: **35 passing / 0 failing**, 338.172 seconds. These are **5 new publication/guidance cases plus 30 existing or corrected public controls**, 35 distinct cases per runtime; repeated runtime/red-green execution does not increase feature counts. Source remained frozen throughout these runs. This is focused acceptance, not a repeated 205-case assembled/full suite. WT76 owns rebuilt assembled/npm/MCP acceptance after integration; it was informed to include the five new publication cases.

Exact-source SHA-256:

- `get_recovery.ts`: `d2b2702932952508809cf75194e597f089dd314cdf8e5008e74bc18c17fe4396`
- `engine.ts`: `962a11a5530fc11a924a49e3975d6bf35e7cb8df0f917dc4902dea6eced1ca65`
- `metadata_ref.ts`: `c70b9bdaaa627ec2ea766e8fa7d5a3722d123a979fae8b382417adccaba8506a`
- native: `ae04d25e22945cf8b6546b01165f460f9356f012ed6df9d89b852471a53227e3`

## Limits

No general transaction/abort/rollback system is added. After completed Git replay with failed/changed metadata publication, there is no verified live rebase to resume; reached refs and concurrent metadata remain and manual inspection is required. Source refs are identified for inspection rather than claimed universally retained. Valid bound conflicts with temporary freeze/occupancy remain recoverable once their blocker is addressed.

No push, GitHub write, CI/full matrix, live service fixture mutation, package publication, release or user-installation change occurred. This worktree remains reserved for the later independent review findings.

## First-pass readiness

Commit: `046e85ad3df4372f099a8e07461d9dc430d34d94` — `fix(get): verify publication and pending import authority [skip ci]`. Six intended paths were explicitly staged and committed through Anthracite MCP `modify --commit`. The exact source/artifact hashes and all 35-case receipts above match this commit's production source.

Final reconciliation ran `git merge get-updates -m 'Merge current integration into review fixes [skip ci]'` and reported already up to date at integration `321e81e7704ba88e0837ce458448ada50180b611`; no merge commit was necessary. Working tree is clean. Ready for root integration; the worktree and this same worker remain reserved for later independent review findings. No requested first-pass correction remains pending.
