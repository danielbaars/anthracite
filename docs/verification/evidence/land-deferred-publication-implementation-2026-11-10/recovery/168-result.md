# Ticket #168 implementation result

Status: complete; committed, integration merged, worktree clean. All nine functional cases pass on both runtimes, plus final overlap/diagnostic deltas.

Worktree: `/private/tmp/anthracite-168-20261110`. Branch: `implement-deferred-land-recovery`.
Implementation commit: `95f496d9`. Static interruption disclosure/assertions commit: `480e59db0f2ca898d68122276925a4e27a486c9f`.
Latest integration merged cleanly: `a0a366bd6d2af4df35e3880876d57dece17415d4`.
Own merged HEAD before diagnostic-only follow-up: `d43f0a86d1c50a9bba6326ab20af497d429b8dfa`. Final handoff HEAD: `480e59db0f2ca898d68122276925a4e27a486c9f`. Latest integration merged again before handoff: already up to date.

## Implementation

Export pure `assertLandingProgressUnchanged(record)` from `landing_progress.ts`, reusing the existing exact-byte ownership check without writing or normalizing the saved file. Maintenance checks this after awaited cleanup-result inspection, after fresh pre-publication PR inspection, immediately before PR edit, and after verified PR readback before returning to parent cleanup. Local participant/worktree/frozen checks repeat after the awaited publication identity read. A concurrent recovery write can no longer cause a push or PR edit before the later save detects the race. Failure output explicitly retains reached local work and unconfirmed publication/base/footer work.

No scheduling/version/parser migration changes. Existing acknowledged-head readback skips duplicate pushes. Fresh matching PR base/body reads skip duplicate uncertain writes; stale bodies are repaired from fresh descriptions. The only `land_scoped.ts` change is the static SIGINT message explicitly retaining local work and pending publication/base/footer obligations; #167 inspection/presentation functions are untouched.

## Public-process acceptance

New `apps/cli/test/commands/land_deferred_recovery_cli.test.ts` contains nine CLI cases:

1. Concurrent saved-record change during fresh gh read before push: preserves foreign bytes, no client push/PR edit, landed parent retained.
2. Concurrent change before PR edit: acknowledged head remains received; no PR edit or cleanup.
3. Concurrent change after PR edit/readback: completed PR effect retained; cleanup still refused, foreign bytes preserved.
4. Acknowledged push then failed PR edit: retain local-vs-published deferred identity, fresh descriptions/title/roles/unmanaged text/draft preserved on retry; no repeated received target updates; cleanup held until reconciliation.
5. Real SIGINT after local replay before publication: own lock released, local tip differs from unchanged remote, saved original publication identity retained; retry completes exactly one update per target.
6. Real SIGINT after acknowledged push before PR reconciliation: saved publication retained; retry does not repeat push.
7. Bare-remote pre-receive rejection: actual remote does not receive child; no PR edits or parent cleanup. Retry receives each target only once, separately observes failed client attempt.
8. Real SIGINT during required-check wait: deferred tip stays unpublished; retry revalidates and completes without repeating merge/update.
9. Completed PR edit with lost acknowledgement: retry uses fresh matching body/base and sends no repeated matching edit.

All use public CLI processes, real local Git/bare remotes and controlled gh boundary. Real pre-push and post-receive observer distinguishes attempted and received updates/deletions. No new private test APIs.

## Receipts so far

- First red before source fix: concurrent-record test observed one client/received child push although expected zero; Mocha 0 passing/1 failing (21 seconds).
- Pure guard made original test green: 1/1 Node.
- Node initial four (three record races + failed PR/fresh body): 4/4 passing, ~2 minutes.
- Node real SIGINT stages: 2/2 passing, ~2 minutes.
- Node remote rejection/required-wait SIGINT: 2/2 passing, ~2 minutes.
- Node lost PR acknowledgement: 1/1 passing, 52 seconds.
- Failure wording red: failed-publication case stopped at missing explicit reached-work diagnostic (0/1).
- Final wording/final pre-maintenance guard Node delta: 2/2 passing (~2 minutes), acknowledged PR failure/fresh body and remote rejection.
- Source/new-test lint, formatting, typecheck and `git diff --check` pass.

- Complete native campaign: 9/9 passing, zero failures (~5 minutes), using `/private/tmp/anthracite-168-native-20261110` before final added diagnostic/assertions and one pre-maintenance ownership assertion. The final assertion/diagnostic delta is separately checked below.
- Post-#167 final native overlap/delta: 4/4 passing, zero failures, 139213ms. `168-final-native.json` covers concurrent guard before push, acknowledged-push PR failure/fresh content, rejected publication, required-check SIGINT waiting. Uses merged HEAD d43f0a86 plus no subsequent functional changes.
- Post-#167 Node overlap: 2/2 passing, zero failures, 65810ms. `168-post-integration-node.json` covers concurrent guard and required-check SIGINT waiting.

- Final static SIGINT-diagnostic Node: 1/1 passing, zero failures, 43487ms (`168-signal-node.json`). Native: 1/1 passing, zero failures, 38092ms (`168-signal-native.json`). Recompiled from final source; shared handler is exercised through required-check waiting, which resumes and completes all three merges.
- Final source/new-test/changed-scoped-file lint, formatting, TypeScript compilation and diff check pass. Worktree clean after both commits.

Receipts are process-generated Mocha JSON and remain at the context paths above; hashes are in `168-SHA256SUMS`. The earlier complete campaign was observed through tool stdout and is summarized honestly here; it was not captured as a nine-case JSON file. Final exact-source coverage uses the bounded additional receipts rather than repeating the whole campaign. No workflows, live GitHub, active installation or user-project changes; no pushes or issue/PR mutations. Known baseline unrelated landing recovery failures were not modified.
