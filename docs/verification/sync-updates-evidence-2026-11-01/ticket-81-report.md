# Ticket 81 — cleanup-only sync consent

## Scope and identity

Implemented approved issue #81 as an independent slice of #78; later feature refresh/default restack/recovery work remains outside this slice. No new dependency, framework or generalized abstraction. Worktree `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/81`, branch `sync-updates-81`.

- Exact starting HEAD/base: `23483b9b4842396a0b96fb15922f6bdd1b436dd8`.
- Commit created through An MCP `modify --commit` with explicit staging and normal hooks: `ffd052e6f993f74eb9b448b23c6cef44ab990a71` — `feat(cli): add cleanup-only sync delete-all consent [skip ci]`.
- Commit tree: `189f59115bcdb2f28033909daf776dbab399df48`.
- Latest `sync-updates` merge check: already up to date at starting base; working tree clean after commit. Root owns subsequent integration and publication.

## Changes

- `apps/cli/src/commands/repo-commands/repo_sync.ts`: boolean `--delete-all`, default false, no short alias; handler passes `deleteAll`; shared builder supplies top-level and both legacy routes. Help explicitly limits consent to eligible local cleanup and names no-delete precedence, trunk-reset and feature-overwrite exclusions. Existing completion derives the option directly from this builder.
- `apps/cli/src/actions/sync/sync.ts`: combine delete-all with force only when supplying cleanup consent. Trunk still receives only the original force flag. Suggest delete-all rather than force for cleanup-only unattended use. Existing no-delete gate remains authoritative.
- `apps/cli/test/actions/remote_actions.test.ts`: existing direct callers explicitly supply `deleteAll: false` for type completeness; no internal-seam tests added.
- `apps/cli/test/commands/sync_cleanup_descendants_cli.test.ts`: preserve existing force B02 coverage and exercise the same externally observed real-Git scenarios under delete-all; verify each separated candidate is deleted once.
- `apps/cli/test/commands/sync_delete_all_cli.test.ts`: 14 public-CLI real-Git cases covering consent, all routes/forms/negative forms, default decline and no-delete precedence; true trunk divergence vs legacy force; empty/unassociated/local work; deleted remote head; frozen survivor vs independent frozen candidate; target/survivor worktrees; terminal declined-ancestor traversal; tracked dirt; explicitly disabled service; help/completion/unknown option.

## TDD receipts and fixture correction

Approved seam used: spawned public CLI, actual temporary repositories/bare remotes/worktrees, actual refs/index/files/parents and only external gh boundary controlled.

1. `81-red-consent.log`: original single public behavior failed (0 passing, 1 failing) with `Unknown arguments: delete-all, deleteAll` before executable implementation.
2. `81-green-consent.log`: same behavior passed (1 passing) after minimal option/cleanup-consent implementation.
3. `81-node-consent.log`: incremental controls had 9 passing and 1 fixture-expectation failure. This originally used local-ahead trunk; legacy `git pull` correctly returns up-to-date and preserves that local work. Changed the fixture to make remote and local histories truly divergent. No product reset behavior was changed in response. This raw failure is retained, not counted as acceptance.
4. Final relevant controls below passed against the committed source. Existing safety controls were retained rather than characterized as newly implemented protections.

## Commands and results

Pinned Node `/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node` reports `v24.19.0`; prefix its directory in PATH for spawned fixtures. Commands run from the owned worktree unless noted. Mocha commands run from `apps/cli`. Each run used a separate `ANTHRACITE_TEST_EVIDENCE_DIR` under `evidence-81`; generated test fixtures isolate HOME/global Git config and retain real hooks.

```sh
node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache
node node_modules/prettier/bin-prettier.js --check apps/cli/src/actions/sync/sync.ts apps/cli/src/commands/repo-commands/repo_sync.ts apps/cli/test/actions/remote_actions.test.ts apps/cli/test/commands/sync_cleanup_descendants_cli.test.ts apps/cli/test/commands/sync_delete_all_cli.test.ts
git diff --check
```

Build/noEmit/full-source uncached ESLint/format/diff checks passed (`81-eslint.log`, `81-noemit.log` retain empty successful output). No generated tracked files changed.

Node acceptance was built incrementally without rerunning unchanged cases:

```sh
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_delete_all_cli.test.js dist/test/commands/sync_cleanup_descendants_cli.test.js
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_delete_all_cli.test.js --grep 'remote head was already|occupied mandatory|terminal user declines'
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/frozen_sync_cli.test.js --grep 'required cleanup replays|unrelated saved continuation|real terminal cleanup|prepared metadata hooks|prepared ref hook|staged, unstaged'
```

- `81-node-final.log`: 17 passing (11 consent cases as compiled at invocation plus all 6 B02 force/delete-all cases).
- `81-node-extra.log`: 3 passing (subsequently added public guards); together 20 distinct acceptance cases.
- `81-node-frozen.log`: 7 passing existing focused compatibility/safety cases: real terminal yes/no; prepared metadata-hook survivor freeze; prepared deletion-hook survivor freeze; unrelated saved continuation retention; active-operation refusal before cleanup replay; quiet staged/unstaged/untracked preservation.

Independent native compilation (Bun reports `1.3.14`):

```sh
/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun build --compile apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/an-81-native
```

Native runs use exactly the Mocha commands for the 2 complete acceptance files and the focused frozen grep above, with `ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/an-81-native`.

- `81-native-final.log`: 20 passing (all 14 consent cases and 6 B02 force/delete-all cases).
- `81-native-frozen.log`: 7 passing the same distinct existing controls.

These runtimes repeat the same case identities; they are not additive feature counts. Full matrix, CI, live service writes, npm publication/installation and installed MCP acceptance were not run. Ticket #87 owns exact npm/MCP acceptance.

## Artifact hashes

SHA-256:

- Full source-file hash manifest `81-source-sha256.txt`: `a36dc458f8cc197ab6781ef1cf85d5f97a81a903695225b2f90b066f1986204f`.
- Full compiled Node source-tree hash manifest `81-node-artifact-sha256.txt`: `af2f8b0235aef4f734e17bb7bd4ed5c6427266661c87caff713a38c803f1da59`.
- `apps/cli/src/actions/sync/sync.ts`: `47ade202a9a6305bf561471d03d7c8c81745584e9211e8e3a293d2237a409a9c`.
- `apps/cli/src/commands/repo-commands/repo_sync.ts`: `2c1bed7757017f851e83be37bf0b2fd0fdeb01699974181ddbd6128fb525a6be`.
- Node entry point `apps/cli/dist/src/index.js`: `f41af96e346bcfc1648d5636bc8feb109e70d0df7e5fd91e9a4ebf2b07c010bd`.
- Independent native binary `an-81-native`: `f732e904b9d46c249a63be08537897a2f2f1e1d76c4010b8f7f98e5ff715ce71`.

## Integration notes and limits

No feature-source refresh, replay-default, recovery redesign or trunk authority redesign is inferred from these cleanup tests. Slice #79 owns descriptions changed by its new refresh behavior and external-gh fixture headRepository/stored closed-PR head semantics. Its worker was told #81 builder is available after this commit. Shared sync action modifications are limited to the option type, cleanup consent expression and cleanup tip, so root can preserve those while integrating #79.

No GitHub/remote/issue/PR writes or pushes by this worker; no owner installation touched; clean worker worktree retained for root cleanup. Remaining dependent slices and assembled acceptance belong to their assigned tickets. Local-ahead trunk retains the preexisting no-op behavior; true divergence is the checked reset-permission boundary here.
