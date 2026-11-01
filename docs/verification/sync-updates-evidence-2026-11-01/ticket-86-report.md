# Ticket 86 implementation report

Final clean handoff: `775b4e0f23aeae70f2dea910ea3348dac582cbac`, branch `sync-updates-86`, integration ancestor `65e0a492cb9e43c86b6b4fd8a046898e500a8d54`. CLI source tree `e2384c9488aa63141d40fad0139f96e2fbb89e5f`. All required local checks complete; no tests/source edits remain active. Ready for root-owned merger and ticket87.

## Scope and starting identity

Exclusive worktree `/private/tmp/anthracite-sync-updates-implementation-20261101/worktrees/86`, branch `sync-updates-86`. Verified clean exact integration HEAD `65e0a492cb9e43c86b6b4fd8a046898e500a8d54` before edits; current sync-updates remains that ancestor. Read actual issue86, full spec/task graph, handoff86, final85/final84 reports, acceptance map/evidence index and repository AGENTS/CONTRIBUTING/installation/glossary. Applied invoked implement-spec from `/Users/danielbaars/Dev/agent-skills-registry/upstream/mattpocock-skills/skills/engineering/implement-spec/SKILL.md`, TDD, TypeScript, Ponytail and Anthracite stacked-PR guidance.

Approved seam: public CLI processes over real temporary Git repositories, bare remotes, linked worktrees and original Git hooks. Only external gh responses are controlled through the existing fixture. No private engine/replay/fetch mocks, new dependency/framework, delegation, worker push, GitHub mutation, CI/full matrix, live fixtures, package/release publication, owner installation or primary checkout changes.

## Confirmed fixes

1. An original pre-rebase hook could replace the owned sync recovery file with a foreign legacy record. The internal participant check returned when no sync role remained, so a local maintenance head advanced before the later owner-save refused. A missing record had the same trust boundary. The existing hook proxy now carries the digest of the last **verified writer bytes** to the internal guard, which checks those bytes after the original hook and before managed HEAD writes. This token never comes from a fresh read that could adopt a replacement/absent role. Legitimate saves/continuation binds update the token through the existing recordSyncRecoveryWrite. No recovery format, user authority, engine or transaction is introduced.
2. A source activation reference hook could replace the recovery owner before incoming application, allowing the first head update before a later save refused. The existing guarded activation path now checks the trusted byte-owned record after activation and before applying the incoming node, only for an owned sync context. Get/legacy workflows keep their existing path.

Original hooks still run. Actor recovery files/ref metadata are preserved; no rollback or reconstruction occurs. Existing raw opaque out-of-graph OIDs and intended-publication checks are unchanged.

Production paths: `apps/cli/src/actions/sync/get.ts`, `apps/cli/src/actions/sync/sync_recovery.ts`, `apps/cli/src/commands/internal_commit_guard.ts`, `apps/cli/src/lib/git/frozen_commit.ts`. New public integration file: `apps/cli/test/commands/sync_late_guards_cli.test.ts`.

## Public incremental evidence

- `86-red-hook-owner.log`: baseline production exact65e0, new public test only, **0 pass/1 fail**. Foreign pre-rebase owner replacement was preserved, but local-work changed from its captured original OID, proving replay occurred before the later refusal. `86-green-hook-owner.log`: **1 pass** after the initial token guard. The initial guard token implementation was then tightened to originate only from trusted recordSyncRecoveryWrite bytes, rather than reading owner state afresh at proxy creation.
- `86-green-trusted-owner.log` is intentionally retained under its original filename despite its result: **1 pass/1 fail**. At this intermediate trusted-token candidate, the pre-rebase case passed; the newly added activation-owner case failed because the first incoming head advanced. This is the second real red, not a green result. `86-green-activation-owner.log`: **2 pass** after the post-activation ownership check. Intermediate compiled artifacts were rebuilt between completed cycles; no immutable historical artifact claim is made for these exploratory cycles. First red production source is exact65e0 / tree33883cc5d434380909dd18ab9159268d32cf6e2e / map SHA256a9b8288229560e54b314fbcd1083a7671f47889f74df944c6b4a86412806d208. `86-red-source-identities.json` records that map and an explicitly post-run **reconstructed**, not contemporaneously frozen, second-red source map3f65e495a6fc590393af70707124bd5e0e370e4ccb51b5dc6776db4c1f0059a5; exact recorded pre-activation-check source edits are archived as86-trusted-token-red-src-reconstructed. No historical compiled/native hash is asserted for that intermediate red.
- `86-owner-controls.log`: **2 pass**, missing pre-rebase owner and byte-level changed envelope from an original continuation prepared-ref hook both refuse before active ref advancement.
- `86-transient-freeze.log`: **1 pass**, a newly frozen active conflict refuses continue-all with byte-equivalent physical/index/files/recovery state, then clears legitimately. Fresh continuation preserves ignored/untracked work, alias ref, explicit local rebase.updateRefs=true and configured original hook execution.
- `86-pending-hook-controls.log`: **5 pass**, late pending worktree occupancy stops active advancement then resumes after clearance without touching the other worktree; four original prepared continuation hooks change a pending head/parent/freeze/source and preserve actor state before active publication.
- `86-incoming-hook-controls.log`: **5 pass/1 fail**. Selected actor head, PR metadata, injected shared source, redirected physical checkout and unrelated occupancy controls passed. The failing unfreeze probe was a **fixture error**, not an additional product gap: advanceBoth made the child already current, so no frozen-anchor replay was planned and editable descendant maintenance was legitimate. Corrected probe advances only the parent, leaving a genuinely stale frozen maintenance anchor. `86-corrected-anchor.log`: **1 pass**, fresh unfreezing cannot expand that saved replay authority.

These incremental runs overlap the final16 scenarios; do not add their counts as new cases. All raw failures remain outside the source repository. A sandbox diagnostic `ps` was denied; no process or product state was changed by it.

## Frozen source/artifacts and commands

Pinned Node24.19.0 `/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node`; Bun1.3.14 `/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun`.

All final emits/native build ended before frozen final runtime cohorts. Source and artifacts stay unchanged through those runs. Manifest `ticket-86-source-artifacts.json` and reproducer `86-freeze.py` record all286 production TS files,286 compiled production JS files,246 test TS files and249 compiled test JS files, plus the independently compiled native executable. Map hashes are SHA256 of sorted-key JSON maps.

- Production source map: `f752ca295bf3b5240f51589e65069e5b02dcde5157e96a34bbd1df9d216f99ad`.
- Compiled production map: `a3fa8bfe691b21cec223bf6c47180b4d1cd9bafe1dbbd7e1b9110bca674e3a94`.
- Test source map: `64895fe6e3463207cc0252d6495c093f928cfe7c0b341577d94e7d6a3ab0d3a4`.
- Compiled test map: `9ba0cca94dbf536e5fce63b229929f2d4bccbe47f63f2dc6b5447bf517d5cb78`.
- Native `ticket-86-an` SHA256: `05bbfde63c00a86a61cc4687a7695fec4242864dcce0dfa84f9509c294b4f0c2`.

Build: pinned node `node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json`. Native: pinned bun `build --compile --target=bun-darwin-arm64 apps/cli/dist/src/index.js --outfile /private/tmp/anthracite-sync-updates-implementation-20261101/ticket-86-an`. Full source uncached ESLint `node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache` passes, `86-eslint.log` empty. Typecheck `node node_modules/typescript/bin/tsc -p apps/cli/tsconfig.json --noEmit` passes, `86-noemit.log` empty; the final fixture-only correction also compiles successfully in86-build-anchor.log; final source/test noEmit also passes (`86-noemit-final.log`, empty). No emits occur into any active runtime tree.

Own final command from apps/cli: `PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH node ../../node_modules/mocha/bin/mocha.js dist/test/commands/sync_late_guards_cli.test.js`. Native repeats with `ANTHRACITE_TEST_BINARY=/private/tmp/anthracite-sync-updates-implementation-20261101/ticket-86-an`.

Bounded compatibility exact files/grep are in `86-compatibility-command.sh`, with global Git isolation and explicit local true cases retaining their configuration. The19-case `86-compatibility-inventory-ONLY.json` is **dry-run naming inventory only**, never an acceptance receipt despite Mocha's generated passing counters. Actual passing runtime outcomes are recorded below. Selection covers B02 both consent flags, frozen mandatory original-hook protection, owned incoming→maintenance/fallback and pending-PR lookup guards, sync opaque/final-source physical completion, independent get scope/force/fanout/final ownership/publication, structural insert recovery, landing recovery and representative legacy continue/repo-sync continuation.

## Final outcomes and handoff

Frozen final receipts, all against the same source/artifact manifest:

| Cohort | Node | Native |
| --- | --- | --- |
| New assembled late guards | `86-node-final.log`: **16 passing (4m)** | `86-native-final.log`: **16 passing (3m)** |
| Bounded existing compatibility | `86-node-compatibility.log`: **19 passing (6m)** | `86-native-compatibility.log`: **19 passing (6m)** |

This is35 distinct scenarios per runtime:16 new plus19 existing regression controls. Both runtimes execute the same case identities; they are not70 new features. No final runtime failure or fixture timeout occurred in these four actual cohorts. Historical incremental failures above remain failures/qualifications, never relabeled as final passes.

`86-final-frozen-verification.log` confirms every recorded production/test source, compiled JavaScript and native byte remains unchanged after all four cohorts. Post-commit/merge verification repeats the same identity successfully. No production/test emit occurred during any frozen runtime cohort.

Explicit five-path staging and Anthracite MCP `modify --commit --message` created `775b4e0f23aeae70f2dea910ea3348dac582cbac`, `fix(sync): bind hook guards to verified recovery bytes [skip ci]`. Commit contains35 production additions/one replaced import plus the481-line16-case public integration file (total516 additions/one deletion). Original hooks remain enabled. Anthracite Git passthrough `merge sync-updates --no-edit --message 'Merge sync-updates into sync-updates-86 [skip ci]'` reported Already up to date. Verified current integration65e0 ancestry, empty worktree/index, diff checks and post-commit frozen bytes. Other task-owned old worker branches shown as needing restack were left untouched; ticket86 itself is clean and based on current integration. No worker push or remote action occurred. Ticket87 owns assembled acceptance, exact isolated npm package/one real stdio sync MCP and public guidance; root owns merger, the single approved PR88, remote operations and final independent reviews. No full suite/matrix/CI or broader audit is implied.
