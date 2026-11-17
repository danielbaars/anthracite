# Explicit unconfirmed landing retry: implementation and delivery

This source candidate adds the recovery route described by the [approved specification](../specs/land-unconfirmed-retry.md) for [#189](https://github.com/danielbaars/anthracite/issues/189), including its five implementation tickets #192–#196. The published npm 0.8.2 package does **not** contain `--retry-unconfirmed`. The candidate deliberately retains source version 0.8.2; version output alone cannot distinguish it. Check the selected executable's help and artifact identity.

## Implemented behavior

`an land <original-target> --retry-unconfirmed --dry-run` preserves progress while disclosing one pinned current PR/effective head and all remaining original work. Application displays the same plan before a separate confirmation; `--yes` supplies that confirmation only for explicitly authorized unattended application. Plain resumption, preview, installation, executable switching and saved retry intent grant no exceptional request authority.

Each confirmed invocation may attempt one new expected-head direct rebase request for that current uncertain PR. Fresh identity, remote/local head and base ancestry, ownership, scope, policy, approval, required-check and publisher guards remain authoritative. Confirmed matching results need no new request. A later uncertain PR needs new named consent. Version-1 eager and version-2 deferred schedules, earlier confirmed merges, reached heads and pending maintenance survive recovery.

Exact source bytes and UUID-bound intent are retained privately and durably before progress replacement and dispatch. A strict optional active marker makes unsupported older readers refuse preserving. Request permission remains process-local. New rejection or readback failure preserves the older uncertainty, concrete diagnostics and attempt history. Interrupted re-entry validates all preceding evidence; cycles, corruption, unavailable evidence and more than 128 retained attempts refuse without discarding sources. Ordinary completion clears the active gate while retaining immutable audit archives; archives alone do not block downgrade.

The existing MCP `learn_an` and argument-array `run_an_cmd` routes expose the same boundaries and explicit `cwd`. No MCP tool, queue, bypass, implicit approval or publication route was added. The owner's approval conventions still apply.

## Producers and candidate artifacts

The genuine published producers were installed in isolated temporary prefixes without changes to the active installation. Records were produced by their public CLI processes, without schema rewriting.

| Producer | Scheduling authority | Installed CLI SHA-256 |
| --- | --- | --- |
| npm `@danielbaars/anthracite@0.6.15` | Version 1, eager | `b5ec9d945824443cd441ae9f40220d174ef4c367952e7c264186a2bfc0882608` |
| npm `@danielbaars/anthracite@0.8.0-beta.1` | Version 2, deferred | `7a68d49fb520991931bb5787f87ba8c10bf343d42582e201ad1940fe32082344` |

The candidate was compiled directly from the ticket-196 worktree based on integrated commit `129137c7dbbca082cbff17f764e52a6c41ef81a7`, plus the delivery changes in this verification commit. Shared dependencies were reused; Yarn workspace commands were not used to build satellite source. Node tests execute that worktree's emitted CLI, and native tests execute its Bun-compiled binary. The npm builder copied that same emitted source into disposable bundling input, then the package gate installed the exact tarball offline into a fresh temporary prefix with isolated HOME/config/cache and sanitized credentials.

| Candidate artifact | SHA-256 |
| --- | --- |
| npm tarball, source version 0.8.2 | `a12d197389d4103e6107d0bca52472bf56a3b9e979d5f517fb5079a646619c71` |
| macOS ARM64 native executable | `64b14ca05c16ce5f5bb53848176626187ce74d9089e905a009d55b452f812044` |

## Bounded acceptance

All workflow tests use public CLI or the existing SDK MCP client, real temporary Git repositories and bare remotes. Only the existing `gh` service boundary is controlled. They assert requests and expected heads, actual trunk/ref/metadata changes, preserving refusals, exact archived bytes and usable subsequent commands.

| Campaign | Node | Native |
| --- | --- | --- |
| Integrated preview/execution, interrupted recovery, partial-stack schedule and delivery files | 30 passed | 30 passed |
| Representative inherited normal leaf, accepted lost response, definite405 and unknown transport cases | 4 passed | 4 passed |

The focused integrated files are `land_retry_preview_cli`, `land_retry_recovery_cli`, `land_retry_partial_cli` and `land_retry_delivery_cli`. They cover genuine older producers and preserving older readers; explicit target/consent; private archive refusal; head/identity/local/policy/check blockers; successful recovery and already-merged races; interruption before active CAS, at intent, dispatch, acceptance and readback; corruption/receipt failures; earlier merges and reached heads; eager/deferred survivor publication; later uncertainty receiving no inherited permission; completion and checkout restoration.

The two new delivery cases first failed on absent explicit-target help and absent MCP retry learning, then passed. The CLI case compares preserving preview with the complete application disclosure before declining confirmation. The MCP smoke learns, proves plain `--yes` and missing application confirmation cannot send a request, previews preserving, then explicitly applies one expected-head rebase and verifies trunk, cleanup and retained source evidence. The isolated installed selection runs those two cases plus preserving rejection and renewed uncertainty recovery; its MCP case uses a genuine older-producer record when the local producer variable is supplied.

The isolated offline package gate passed its existing 29 executed baseline cases, all four selected retry cases and the `anthracite` alias case. Two pre-existing cleanup cases requiring a separate npm 0.6.11 producer were pending because that unrelated optional input was not supplied; both requested retry producers were supplied, with no pending retry cases. Existing CI still supplies its own 0.6.11 cleanup producer.

The first sandboxed baseline attempt could not observe the `ps`-based numeric-zero cancellation hook. Direct `ps` was also denied. The complete unchanged package gate passed when rerun with process visibility; no assertion or supervisor behavior was weakened. Direct TypeScript compilation, targeted ESLint, Prettier, workflow `actionlint`, local documentation links and `git diff --check` passed.

Reproduction after building:

```sh
ANTHRACITE_TEST_LANDING_V1_PRODUCER=/absolute/isolated-v1-prefix/node_modules/.bin/an \
ANTHRACITE_TEST_LANDING_V2_PRODUCER=/absolute/isolated-v2-prefix/node_modules/.bin/an \
node node_modules/mocha/bin/mocha.js \
  apps/cli/dist/test/commands/land_retry_{preview,recovery,partial,delivery}_cli.test.js
# Repeat with ANTHRACITE_TEST_BINARY=/absolute/candidate-native.
node scripts/build-npm-package.cjs
node scripts/test-npm-package.cjs
```

Node 24.19.0, TypeScript 5.5.4 and Bun 1.3.14 were used. The ordinary CI job adds only the two delivery cases; the existing isolated npm gate adds four representative retry cases. The manual full matrix remains off.

## Limits and publication scope

Controlled GitHub responses establish adapter/workflow behavior, not live GitHub acceptance or real PR readiness. Separate reads and requests are not atomic; fresh guards, expected-head constraints and GitHub enforcement remain necessary. Retry is new authority under acknowledged uncertainty, not an exactly-once delivery guarantee.

Independent review identified a contradictory-state case outside genuine producer output: a saved unconfirmed phase can carry a recorded result while fresh evidence still says the pinned PR is open. The delivery artifacts above predate the additional preserving guard for that case. This is a review blocker before final acceptance; its focused regression and replacement artifact identity must be recorded after the review fix.

No live GitHub test PRs or mutations, CI dispatch, npm publication, user project/installation changes or MCP configuration edits were performed. This candidate supplies an executable recovery route for the original report; publication and issue closure remain separate approved actions. Any later review fix that changes the candidate requires appropriate re-verification and a new artifact identity.
