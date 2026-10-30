# PR review and scoped stack landing: implementation acceptance

This candidate implements [#57](https://github.com/danielbaars/anthracite/issues/57) and its seven dependent slices, [#58–#64](https://github.com/danielbaars/anthracite/pull/65), in one integration branch and [PR #65](https://github.com/danielbaars/anthracite/pull/65). The contract is the approved [specification](../specs/pr-review-stack-landing.md). Package metadata still says 0.4.0; these workflows have not been released in that version.

## Result and source identity

The public commands are `pr [branch]`, `review [branch]` and `land [branch]`. They inspect fresh configured-repository PRs, submit one review bound to an explicit head and land only the selected trunk-to-target chain. Mandatory surviving descendants receive separate maintenance; independent trunk stacks remain outside the scope. Raw `an merge` retains its Git meaning.

Production source is `cbd4b7964a2fdcb05fcdab6f2c4e9ac3f13b70de` (tree `034362659f02c8fa1626ffde3ed91d89dc2bf0d6`), compared against baseline `a070dd5ce4890a37a4e6506bb2b2fd50752c5379`. Final test source is `735a3d9a83f3efdd6a20920510cf8b7564c79a8d`. Its two follow-up commits change tests only: all 270 production source files and all 810 compiled production files remain byte-identical. The sorted production-source SHA-256 aggregate is `be245d1aa6620f8bb058c0ee1881ab82a30054da6811109afecbff9954a2864d`.

## Local acceptance

| Runtime/artifact | Distinct passing feature cases | Separate passing legacy controls |
| --- | ---: | ---: |
| Node 24.19.0 | 112 | 7 |
| Mac ARM64 native, compiled with Bun 1.3.14 | 112 | 7 |
| Isolated installed npm bundle, real stdio MCP workflow | 1 | — |

The [summary](evidence/pr-review-stack-landing-2026-10-30/acceptance/summary.json), [case ledger](evidence/pr-review-stack-landing-2026-10-30/acceptance/manifest.json) and 35 retained raw reports identify each accepted case by file, full title, test-source hash and report hash. Overlapping cohorts are not added together. The [evidence checker](evidence/pr-review-stack-landing-2026-10-30/acceptance/check.cjs) verifies report hashes and passing membership against the complete 112-case inventory; it does not rerun the CLI. From the repository root:

```sh
node docs/verification/evidence/pr-review-stack-landing-2026-10-30/acceptance/check.cjs
```

Tests invoke the public CLI using actual temporary Git repositories and local bare remotes. Only the external `gh` service boundary is controlled. Synthetic rebase merges create different commit OIDs; independent observations check refs, trees, unique commits, metadata and external PR/review state. No private planner or engine mock certifies acceptance.

| Approved test groups | Public evidence |
| --- | --- |
| T1–T3 | `pr_inspection_cli` and `pr_review_cli`: configured repository, literal selectors, preserving inspection, diff and explicit browser opening |
| T4–T5 | `pr_review_cli`: exact review input/head/readback, races, permission rejection and uncertain effects without duplicate posting |
| T6–T8 | `land_preview_cli`, `land_policy_cli` and `land_review_fixes_cli`: merge versus maintenance scope, consent, policy, participant protection and endpoint identity |
| T9–T10 | `land_leaf_cli`, `land_chain_cli` and `land_fanout_cli`: real distinct-OID merges, prefixes, mandatory survivors, fresh readiness and scoped leases/cleanup |
| T11–T12 | `land_recovery_cli`, chain/fanout and review-fix cases: interruption, partial effects, genuine conflicts, local-only continuation, raw abort and foreign records |
| T13 | `land_surface_cli` plus seven legacy controls: help/completion/cwd/quiet, raw Git merge, submit roles/draft, get/sync, numeric zero and prior continuation |
| T14 | `land_mcp_cli` on both runtimes and the exact isolated installed bundle: ordinary envelopes, explicit review/landing and reconnect recovery |

### Interrupted runs and test corrections

The initial parallel runs encountered severe host pressure and were stopped; they are not reported as complete passing runs. Completed passes were retained, and failed or unattempted cases were completed with at most one file worker per runtime. The ledger records the exact union. [Interruption evidence](evidence/pr-review-stack-landing-2026-10-30/diagnostics/parallel-stop.json) and failed reports remain alongside the final results.

Three Node two-merge/fanout workflows also exceeded the original 60-second command limit when run alone. A separate diagnostic completed correctly in 71.70 seconds with the original state assertions. Only those three cases now use a 120-second command budget and 180-second case budget; the global fixture remains 60 seconds and every functional assertion is retained. All three subsequently passed serially. Native had already passed the same cases under the stricter original limit. The [measured-budget record](evidence/pr-review-stack-landing-2026-10-30/diagnostics/fanout-time-budget-result.md) preserves both failed and passing provenance. No production performance optimization is claimed; this measured local latency remains relevant to subsequent practical use.

The MCP test originally expected success for a blocked recovery preview. Its [test-only correction](evidence/pr-review-stack-landing-2026-10-30/diagnostics/mcp-expectation-result.md) expects the normal nonzero `cli_error` envelope and adds stronger preservation snapshots. The final installed test reused the exact package already built and installed, without rebuilding or reinstalling it.

### Build and installed artifact

[Build identity](evidence/pr-review-stack-landing-2026-10-30/build/build.json) records TypeScript 5.5.4 and Git 2.54.0 (Apple Git-157), compilation and native artifact SHA-256 `a148f592752d21378768f18e02c165e6bb7e3129e91439d8fede6c2ed522c179`. Source typecheck and scoped lint also passed during implementation and corrections.

The [installed receipt](evidence/pr-review-stack-landing-2026-10-30/acceptance/installed.json) records offline prefix installation, both command identities/help/completion and preserved notices. Tarball SHA-256: `35c3729f4e153d9bb49f8217470246d819dd61750a0bf802caac680a4fec42de`; installed bundle: `b7e526b86c4929866c454d18dd4e9bc3c0317601ba366a26133a3abc81aa4c45`. The real installed stdio workflow passed 1/1. User installation, npm configuration and MCP registration were unchanged.

## Independent reviews and corrections

The original [Standards review](evidence/pr-review-stack-landing-2026-10-30/reviews/review-standards.md) found no documented-standard breach and two optional naming/duplication issues; both were addressed. The original [Spec review](evidence/pr-review-stack-landing-2026-10-30/reviews/review-spec.md) reproduced cleanup-only chain rewriting and incomplete pending previews. Parent-agent probes additionally reproduced equal-OID wrong-repository cleanup and foreign continuation loss. Corrections preserve merged members until leased cleanup, disclose and validate remaining maintenance, recheck declared repository identity at effect/continuation boundaries, preserve foreign recovery and suppress preview index refresh.

Final [Standards](evidence/pr-review-stack-landing-2026-10-30/reviews/review-standards-final-confirmation.md) and [Spec](evidence/pr-review-stack-landing-2026-10-30/reviews/review-spec-final-confirmation.md) confirmations report no remaining findings in their stated scope. Five independent final real-Git probes and two late-endpoint controls passed. Those reviewer probes used Node 24.22.2; primary acceptance above used pinned Node 24.19.0. The subsequent two test-only commits preserve the reviewed production bytes. Earlier #64 23/25 cohorts, stale assertions and sandbox-denied observer results remain diagnostics, superseded by explicit final case membership.

## Boundaries and follow-up

These results establish controlled-adapter acceptance for same-repository github.com PRs. No live feature review/merge smoke or new Graphite runtime comparison was performed. A disposable live fixture and an independently eligible reviewer, where required, remain a separately authorized follow-up.

Unreadable classic protection, ruleset-only protection with unavailable classic evidence and incomplete required publisher provenance conservatively block landing. Empty checks/reviews alone grant no permission. Supported declared transports are canonical HTTPS, `git@github.com:owner/repo` and `ssh://git@github.com/owner/repo`, with optional `.git`. Git rewrites and SSH routing remain trusted user configuration; declared identity/stable transport checks are not server endpoint attestation. See the complete [landing contract](../land.md).

Completed merges and Git rewrites retain their effects after failure or cancellation. Owned continuation is local-only. Raw abort, ambiguous completion, foreign records and unproven locks require preserving inspection/manual reconciliation; the implementation promises neither rollback nor exactly-once remote execution.

CI and the full matrix remain off; no workflow/account/protection setting changed. No release was published or user installation replaced. Legacy test-scope bug B01 and deferred log issue #12 remain outside this change. [Copied evidence inventory](evidence/pr-review-stack-landing-2026-10-30/inventory.json) verifies retained source copies; original temporary paths inside historical receipts are provenance, while relative ledger links identify durable copies.
