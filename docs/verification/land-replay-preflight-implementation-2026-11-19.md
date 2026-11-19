# Landing replay preflight: implementation acceptance

This is controlled-boundary acceptance for [#204](https://github.com/danielbaars/anthracite/issues/204) and its five implementation slices, against the [approved specification](../specs/land-replay-preflight.md). All processes use real temporary Git repositories and bare remotes. Only GitHub responses are controlled at the existing `gh` boundary. No live PR was merged, published or changed by these tests; user projects and the active installation were untouched. No Actions run or full matrix was started.

> Review status: these results describe the pre-review candidate below. Independent specification review subsequently reproduced a branch-conditional `includeIf.onbranch` configuration gap: replay on another branch could be assessed using the original checkout's configuration. A separate review fix and source-pinned rerun are required before final acceptance; the passing selections below do not claim to cover that case.

## Exact candidate

The tested source is `7d6b45034fd58fdf6af0f8c3a622dce893a6abb8`, tree `cd9be0e6a6e84ad9e40ee5535d9d8d5eb5da61b4`, based on integration `c2b8efd961e067cfa8480a8e46e3fb3cb15ed553`. The evidence-only commit does not change executable code or tests. These artifact hashes identify the pre-review candidate, not a subsequent repaired candidate.

| Artifact                                               | SHA-256                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| macOS native executable, Bun compile of this candidate | `6799ac66bfc70551f4e593e9e6783e2ca7033aa3ce8b46f43ebde38043358e9a` |
| Isolated npm candidate tarball                         | `47cf05c80724eba950010f4b5387cdacf0120033d4dac1d83e4d9b1e039349be` |
| Candidate bundled `cli.cjs`                            | `d7ddd98184afd44ae5fc275ddf0a7325a438a24a9b8fabef6450f47d1986c234` |
| Genuine public npm 0.6.11 cleanup producer             | `08527413082f845fe06e6f22f676e781616595f48ba66ec46d5b1a2145283a7c` |
| Genuine public npm 0.6.15 version-1 landing producer   | `490d9c42c270aa6f242ba44fe441d9d776f3b8fdae100872dac82584d9d65c23` |
| Genuine public npm 0.9.3 version-2 landing producer    | `fec181e1c78051e70b7794ff78ef4ae5e785791ab59f1308dd653d4590afc092` |

The candidate manifest retains development version `0.9.3`; it is a locally built, unpublished candidate, distinct from the public 0.9.3 producer by source and artifact hash. The producers were installed separately, without lifecycle scripts. Their genuine records are created by their public CLI processes during the tests; recovery bytes are inspected unchanged before candidate preview/resumption. Version 0.6.11 is supplied only for the normal package gate's separate historical cleanup controls, never substituted for the landing producers. Retained npm pack manifests identify [0.6.11](evidence/land-replay-preflight-implementation-2026-11-19/producer-0.6.11-pack.json) and [0.6.15](evidence/land-replay-preflight-implementation-2026-11-19/producer-0.6.15-pack.json).

## Results

| Selection                                                                         | Node      | Native    | Installed npm                         |
| --------------------------------------------------------------------------------- | --------- | --------- | ------------------------------------- |
| Complete new replay suites: preflight 7, graph 7, freshness 12, failures 13       | 39 passed | 39 passed | Core selection below                  |
| Help, existing MCP tools and genuine version-1/version-2 saved landing delivery   | 4 passed  | 4 passed  | Included in core selection            |
| Existing #205 conflict / continue / pending-publication / required-check controls | 2 passed  | 2 passed  | Existing npm recovery selection below |

No case in these Node/native selections was skipped or failed. The two runtime campaigns independently verify all 39 new scenarios; the repeated runtime executions are not counted as 78 distinct scenarios. Retained [Node output](evidence/land-replay-preflight-implementation-2026-11-19/core-node.txt), [native output](evidence/land-replay-preflight-implementation-2026-11-19/core-native.txt), [Node delivery](evidence/land-replay-preflight-implementation-2026-11-19/delivery-node.txt), [native delivery plus #205](evidence/land-replay-preflight-implementation-2026-11-19/delivery-native-and-205.txt) and [Node #205](evidence/land-replay-preflight-implementation-2026-11-19/old-205-node.txt) record the individual cases. macOS emitted Xcode filesystem/cache diagnostics during the process-liveness cases; their assertions and final exits still passed.

The [isolated installed core selection](evidence/land-replay-preflight-implementation-2026-11-19/npm-preflight-core.txt) passes all **8 cases**: the four delivery cases, original early-conflict refusal, actual clean fanout, locked trunk-change refusal and missing-object timeout. It uses the exact candidate tarball above, including both existing MCP tools and both genuine landing producers.

The [normal installed gate](evidence/land-replay-preflight-implementation-2026-11-19/npm-standard.txt) verifies offline installation, both command names, completion and curated contents. Its initial group records **30 passed, 1 failed, 0 pending**: the numeric-zero MCP cancellation case never observed its synthetic checkout hook becoming ready under the sandbox. The same exact artifact and case then [pass with normal process visibility](evidence/land-replay-preflight-implementation-2026-11-19/npm-numeric-zero-normal-processes.txt), **1 passed**, without changing code or assertions. This is not an all-green normal-gate result: its downstream retry and alias groups were not reached in that run. A repaired-candidate normal gate still needs a complete rerun with the process visibility required by lifecycle tests. No unrelated product baseline failure is inferred.

## What the cases establish

- **Known replay conflicts:** remote trunk advances independently without local fetch; a later target or intermediate commit conflicts, even when the final branch diff no longer contains the file. Both dry-run and actual invocation refuse before the first merge request, publication or recovery creation. Source object inventory and hashes, refs, checkout, index/files, metadata/cache/configuration and bare refs are preserved.
- **Complete graph and order:** every mandatory published/local-only/deeper survivor is assessed using the original parent graph and evolving replay boundaries. Actual clean fanout landing preserves a completed side arm instead of replaying it onto unrelated later trunk. Confirmed cleanup-only targets use observed merge results without republishing retired branches. Empty/already-applied work remains bounded.
- **Publication and requirements:** actual push-hook and bare post-receive observations distinguish branch updates from deletions. New operations retain deferred target publication and eager published non-target maintenance; local-only survivors stay unpublished. PR descriptions and roles remain intact, and required checks retain authority.
- **Freshness:** changed remote trunk, participant head, parent metadata or replay configuration cannot reuse clean inspection authority after confirmation or under the lock. Changed recovery is preserved. An unrelated advice preference does not invalidate the plan. Initial cleanup-only maintenance has the same first-effect guard.
- **Failure and execution isolation:** active filters, selected executable merge drivers and unsupported shallow/grafted history refuse without project commands. Safe built-in/inherited text and CRLF behavior is retained. Server replay uses server defaults, so local union attributes cannot conceal a server conflict. Missing-object acquisition preserves ordinary source-local transport authentication; transport stderr is not disclosed. SIGINT, SIGTERM and bounded timeout stop owned work before and under the lock, remove owned temporary resources, and preserve foreign resources.
- **Existing recovery:** the new initial assessment does not run retroactively on saved operations. Genuine 0.6.15 version-1 recovery retains eager pushes (`child`, `tip`, `tip`); genuine 0.9.3 version-2 recovery retains deferred pushes (`child`, `tip`). Both finish with exactly three total merges. The #205 cases introduce a real trunk conflict only after the first confirmed merge, continue locally, preview pending publication, publish before fresh required checks and resume without repeating the first merge.
- **Delivery:** the existing `learn_an` / `run_an_cmd` tools expose the same help, guidance and preserving refusal. There is no new MCP registration or tool. Public learning and help were first observed red for the new contract, then green: [help red](evidence/land-replay-preflight-implementation-2026-11-19/help-red.txt), [learning red](evidence/land-replay-preflight-implementation-2026-11-19/learning-red.txt).

## Reproduction

Use Node 24.19.0 and the repository's installed dependencies. Build the TypeScript output, then run the four public suites:

```sh
node node_modules/typescript/bin/tsc -p apps/cli
node node_modules/mocha/bin/mocha.js \
  apps/cli/dist/test/commands/land_replay_preflight_cli.test.js \
  apps/cli/dist/test/commands/land_replay_graph_cli.test.js \
  apps/cli/dist/test/commands/land_replay_freshness_cli.test.js \
  apps/cli/dist/test/commands/land_replay_failure_cli.test.js
```

Compile `apps/cli/dist/src/index.js` with `bun build --compile` and repeat that command with `ANTHRACITE_TEST_BINARY` set to its absolute executable path. Run `land_replay_delivery_cli.test.js` with `ANTHRACITE_TEST_LANDING_V1_PRODUCER` and `ANTHRACITE_TEST_LANDING_V2_PRODUCER` pointing to separately installed genuine 0.6.15 and 0.9.3 executables. Without those inputs the two producer cases explicitly skip; the acceptance above supplied both.

The old #205 selection is `land_deferred_delivery_cli.test.js --grep 'detects early replay conflicts|publishes resolved work'`. Package with `node scripts/build-npm-package.cjs`, install the exact tarball in an isolated prefix using `npm install --offline --ignore-scripts`, and select it with `ANTHRACITE_TEST_BINARY`. `node scripts/test-npm-package.cjs <exact-tarball>` checks the normal installed gate; supply the exact public 0.6.11 executable through `ANTHRACITE_TEST_LEGACY_BINARY` to include its historical cleanup cases.

TypeScript no-emit check, focused ESLint for changed source/test files, Prettier and diff whitespace checks pass. Tests remain public subprocess tests, without a simulator-only testing API or additional dependency.

## Limits

A clean assessment describes captured history transformations, independently from GitHub readiness. It predicts neither exact future GitHub merge IDs nor the outcome of later remote changes. Fresh per-effect identity, review, required-check, lease and recovery guards remain authoritative. Unsupported or unavailable evidence cannot produce a clean assessment. There is no automatic repair, sync, publication, conflict resolution, bypass or change to existing saved-operation authority. These controlled tests do not establish live GitHub acceptance or readiness of a user's actual stack.
