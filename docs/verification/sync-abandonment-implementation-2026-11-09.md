# Preserving sync abandonment: implementation acceptance

Candidate for [#152](https://github.com/danielbaars/anthracite/issues/152) and #154–#157, tested on 2026-11-09 through the approved public CLI-process boundary. This is implementation acceptance, not an npm release or a live GitHub workflow claim. The [original published-0.6.14 observations](sync-abandonment-2026-11-09.md) remain unchanged.

## Observed behavior

Full/short logs and aliases inspect supported pending sync without consuming recovery. Physical checkout and detached pending intent remain distinct; zero-depth detached refusal remains intact. `sync --abort` abandons only owned sync locally after raw Git abort, participant removal, publication failure or a matching active conflict. Reached updates/cleanup/rewrites, HEAD, branch refs/metadata, staged/unstaged/untracked work, manual resolutions and existing source pins remain preserved.

Private archives retain original recovery bytes and observed source identities before release. Interrupted writes publish complete immutable files; matching retry does not overwrite conflicting evidence or quit twice. An existing autostash is retained, including its deterministic private pin. A pre-quit receipt lets a later retry detect missing/corrupt autostash evidence even after Git removes the live rebase directory. Foreign ownership and competing records refuse without granting replay or overwrite authority.

Reports separate recorded completion, current local observations, pending maintenance and unavailable evidence. Remaining conflicts and detached HEAD are disclosed. Abandonment performs no checkout, staging, replay, cleanup, push or PR edit. Existing dirty/frozen/worktree guards continue to apply afterwards.

## Candidate and retained results

Final code source: `495de590bdf23e2c2f862e7b894792319de10c35`, based on main `6bf6eed43844cb4d8c01c40e38d9440c84b0237e` through the single integration branch. Node 24.19.0 and Bun 1.3.14 were used. The candidate tarball retains the development manifest's 0.6.14 version; it was installed only in isolated temporary prefixes.

Tarball SHA-256:

```text
3b3f1832858d191fdd408fde02e0eb7b0f14e55401d2a245a47b2f1c0530d2b5
```

The [retained acceptance summary](evidence/sync-abandonment-implementation-2026-11-09/results.json) distinguishes slice/integration checks from final affected-path and exact-artifact acceptance. Counts describe grouped scenarios, including multiple option spellings or state mutations within a case.

| Campaign | Node | Native | Boundary |
|---|---:|---:|---|
| Pending log inspection and existing log-state controls | 17 passed | 17 passed | #154 slice; [retained execution scope](evidence/sync-abandonment-implementation-2026-11-09/inspection-slice.md) |
| Complete abandonment/retry/delivery files before review fixes | 37 passed | 37 passed | `dfde742a` |
| Final affected autostash, retry, option and delivery paths | 20 passed | 20 passed | `495de590` |
| Existing full/short/long/depth log controls | 49 passed | 49 passed | `65b77af6` |
| Existing sync/recovery/identity/late-guard/delivery controls | 76 confirmed | 76 passed | `064cd74a`; Node 75 initially plus unchanged isolated rerun |
| Exact installed npm retry, published-record and MCP core cases | 9 passed | — | Tarball hash above |
| Complete existing npm package check | 24 + 1 passed | — | Same exact tarball; 24 selected scenarios plus alias control |

Campaigns overlap and are retained separately; these numbers are not an additive unique-test total. There are no pending cases in the final focused or installed campaigns. Final typecheck, focused lint, formatting, diff checks and workflow actionlint pass. The [complete package-check log](evidence/sync-abandonment-implementation-2026-11-09/npm-package-check.log) includes numeric-zero cancellation and same-build execution; it passed with the owned-process inspection permission required by that existing test.

Two independent review findings were reproduced before repair: post-quit retry could ignore missing autostash retention, and accepted long aliases/camel-case options could bypass conflicting-option refusal. The new regressions cover six retained-evidence mutations and sixteen alternate option spellings. Both independent rechecks found zero remaining findings: [Standards](evidence/sync-abandonment-implementation-2026-11-09/standards-recheck.md), [Spec](evidence/sync-abandonment-implementation-2026-11-09/spec-recheck.md).

Earlier verification had two ordinary test-control failures: one existing Node sync late-guard command exceeded its 15-second limit under concurrent campaigns and passed unchanged in isolation; installed npm campaigns inside the sandbox could not start an existing numeric-zero MCP test hook because its owned-process inspection called `ps`, which the sandbox denied with `EPERM`. The identical exact-artifact case passed outside that restriction, without a production or test change; retained [wire evidence](evidence/sync-abandonment-implementation-2026-11-09/numeric-zero-sandbox-wire.json) and the [isolated successful control](evidence/sync-abandonment-implementation-2026-11-09/numeric-zero-unsandboxed.json) distinguish that environment refusal from cancellation behavior. The new MCP test also initially used the wrong capitalization in its expected pending label; that assertion was corrected. These are recorded separately from final acceptance rather than omitted or presented as product fixes.

## Reproduction and boundaries

Build using the repository's checked-in Yarn and TypeScript. The focused public-process files are `sync_inspection_cli`, `sync_abandon_cli`, `sync_abandon_retry_cli` and `sync_delivery_cli`. Select the native executable with `ANTHRACITE_TEST_BINARY`; select an unchanged public 0.6.14 producer with `ANTHRACITE_TEST_SYNC_LEGACY_BINARY`. The distinct existing cleanup compatibility producer remains public 0.6.11 through `ANTHRACITE_TEST_LEGACY_BINARY`.

The npm bundle is built by `scripts/build-npm-package.cjs` and checked by `scripts/test-npm-package.cjs`. That recurring check adds only one combined real SDK-client pending inspection → abandonment → no-op case. Broader installed retry/ownership coverage is a separate local campaign. All repositories/remotes and GitHub responses are synthetic; Git performs real conflicts, abort/quit, autostash and continuation.

The ordinary CI checkpoint at `064cd74a` completed build/typecheck, CLI smoke and PR-safety steps but its check annotation explicitly reported `The job has exceeded the maximum execution time of 10m0s` during package acceptance ([run 42597521145](https://github.com/danielbaars/anthracite/actions/runs/42597521145)). The prior checkpoint had finished in 8m47s. Only that single existing Linux job cap is increased to twelve minutes (approximately $0.07 gross at the documented $0.006/min rate); tests, triggers, job count and manual full-matrix policy are unchanged. Actionlint validates the workflow, and this CI/documentation change does not alter the tested CLI artifact.

No live GitHub test changes, npm publication, user-project edits, active installation changes or full CI matrix execution were performed for this acceptance. Missing-participant continuation remains [#153](https://github.com/danielbaars/anthracite/issues/153). Archive/source-pin pruning, rollback and other workflows' cancellation remain outside scope.
