# Final review corrections — sync #78

Exclusive worktree `ROOT/worktrees/review-fixes`, branch `sync-updates-review-fixes`, started clean at exact reviewed candidate `2dc0c3dfe27e83a9b8d3183600e542d7aef80e0f`. ROOT is `/private/tmp/anthracite-sync-updates-implementation-20261101`. Integration is `/private/tmp/anthracite-sync-spec-20261031/source`, branch `sync-updates`. This worker is the single implementer for final review findings; root owns integration and independent confirmation by the original Standards/Spec reviewers.

## Corrected findings

1. Spec P2: an unassociated tracked branch named `123` was looked up as PR number 123, preventing its actual open PR #3 from qualifying. `lookupPullRequest` now accepts an explicit literal branch selector. Only numeric literal names use supported `gh pr list --head <branch> --state open --limit 2 --repo <configured-repo> --json ...`. Ordinary names retain `pr view`; get targets and stored PR identities retain the existing number guard. A successful empty list means local-only. Malformed/non-array/multiple responses and all failed list commands refuse. A single candidate must satisfy the existing schema, exact configured repository/head/URL and OPEN state. No public flag, branch import, push or GitHub write was added.
2. Standards P3 accepted judgment: removed the unused `SyncMaintenanceProgress` export, unused option, snapshot callback and `getSha` import. The sync operation adapter still forwards the original `onComplete` callback to the shared maintenance implementation, preserving saved progress and completion semantics.

Production paths: `apps/cli/src/actions/sync/remote_update_graph.ts`, `sync_refresh.ts`, `sync_maintenance.ts`. New public test: `apps/cli/test/commands/sync_numeric_branch_cli.test.ts`. Existing fixtures and default command deadlines stay unchanged; the pre-existing four-replay scenario still uses 30s for its single command and restores 15s afterward. npm scenario deadline stays 180000ms. No new dependency/framework/tooling/version/configuration/workflow changes.

## Public TDD and acceptance

Initial numeric 123 / PR #3 tracer bullet on exact baseline production: **0 passing /1 failing** (`review-fixes-red-numeric-open.log`), with the controlled missing PR #123 number-style GraphQL error. After the adapter fix: **1 passing** (`review-fixes-green-numeric-open.log`). This incremental red/green precedes added safety controls and the later successful stored-association repetition; it is not claimed to be an immutable full red artifact tree. The independent original review probe remains preserved under `final-spec-numeric-number-error-probe.*`; the earlier status 0 probe had a different controlled absence response and is not represented as actual numeric gh stderr.

Final numeric tests cover refresh/adoption of PR #3 on head 123, successful stored-number repetition, local-only empty-list absence, wrong head/repository/URL, closed/missing state, ambiguity, malformed/non-array response, service failure, failed lookup claiming absence, and wrong stored PR number. Refusal cases compare full public ref/metadata/physical/index/files observations.

| Corrected frozen cohort | Actual outcome |
| --- | --- |
| Numeric branch identity/absence/safety | 13 passing on Node and 13 on native |
| Ordinary refresh and identity/error controls | 12 passing on each runtime |
| Numeric get and stored-association controls | Four passing on each runtime |
| Maintenance completion/default controls | Two passing on each runtime |
| Owned conflict/core controls | Three passing on each runtime |
| Exact installed npm package | Nine passing, local process inspection permitted |

This is **34 distinct focused identities per runtime**, with no failures, plus the existing nine installed identities. `review-fixes-actual-cases.json` parses actual passing receipt names and verifies Node/native identity equality. Runtimes, repetitions and overlapping older controls are not additional features. The same source/compiled/test/native maps remain unchanged after both runtime cohorts and the package gate.

The rebuilt exact tarball is `ROOT/review-fixes-candidate.tgz`, SHA256 **`e790e0168b45034922124c0c2a94390fa2c81504dab50f78806d17ffb2b96103`**; bundled `cli.cjs` SHA256 **`1c69f702ec34f0b81fe92b418d89062621ddbe98cdac1de046e9342bd9952995`**. The native executable `ROOT/review-fixes-an` is SHA256 **`51381b14a2690b51d7c44c798dfdef59ab0920f0866eaa80bb9f535135f0d1ac`**. They remain outside the worktree. Full payload hashes, literal gate command and curated six-file contents are recorded in `review-fixes-npm-artifact.json`; version metadata remains 0.5.1. `python3 ROOT/review-fixes-package-build.py` bundles the frozen compiled source in isolated disposable build configuration and copies the exact tarball outside the worktree. The unchanged installed gate then runs:

```sh
PATH=/Users/danielbaars/.nvm/versions/node/v24.19.0/bin:$PATH GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 /Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node scripts/test-npm-package.cjs /private/tmp/anthracite-sync-updates-implementation-20261101/review-fixes-candidate.tgz
```

The existing nine scenarios include numeric-zero MCP cancellation, Git/get controls and the single sync stdio scenario introduced by 87. Local `ps` inspection uses the authorized `require_escalated` execution permission; no source/fixture/supervision/deadline workaround. The earlier 87 restricted 8/1 then same-tarball permitted 9/0 receipts remain unchanged under their original artifact. That known sandbox failure was not unnecessarily repeated for the corrected tarball. This correction has one permitted 9/0 gate, not a new restricted-gate result.

Frozen map SHA256 values:

```json
{
  "compiled": "fab1aa7cd98de35a613008c0841527dbc2aafbbf570a2c1bb09695b4a751a2af",
  "source": "7924bd2bce6d3365ada92e53e7a19558aba2429f30b77eada5e3c56db6d6cadc",
  "testCompiled": "e948a063d36aaa913a942516da2452576b8a44d168474a7caaebd387e6e390fc",
  "testSource": "502fdf8527ca4c5b45781b8889c746661bf998291f3ad0d5221817b49c98868b"
}
```


## Commands and source boundaries

Pinned Node 24.19.0 `/Users/danielbaars/.nvm/versions/node/v24.19.0/bin/node`; Bun 1.3.14 `/private/tmp/anthracite-get-sync-research-20261031/native-tool/bun-darwin-aarch64/bun`; TypeScript 5.5.4. Source cwd is the exclusive worktree. Build, noEmit, full source uncached ESLint and native compilation all exit 0; exact source-check commands are in `review-fixes-source-checks.json`. `gh pr list --help` and `gh pr view --help` verify supported head-list syntax and the existing target selector boundary locally.

`python3 ROOT/review-fixes-runner.py node` and `python3 ROOT/review-fixes-runner.py native` run explicit public Mocha files/grep in serial fresh processes. Result JSON retains literal args/cwd/runtime/timings/logs. The native override is `ANTHRACITE_TEST_BINARY=ROOT/review-fixes-an`; global Git config is isolated, explicit local updateRefs controls and real hooks remain authoritative. No an test selectors or broad suite/matrix rerun.

Final source, compiled JS, tests and native are frozen before final acceptance (`review-fixes-source-artifacts.json`, `review-fixes-freeze.py`). No emit targets an active artifact tree. Original 87 and earlier receipts/manifests remain unchanged and retain every failure/retry/source qualification. The earlier 165 sync / 23 compatibility observations are pre-review-source evidence; they are not relabeled as executions of this correction. New focused controls overlap earlier case identities and are not added as new features.

## Limits and handoff

Bounded local macOS ARM64 public CLI/real Git/bare/worktree acceptance with controlled external GitHub only. No live GitHub/Graphite/enterprise/platform/full-suite certification. No CI/full matrix, live fixture mutation, worker push/GitHub mutation, release/npm publication, owner installation, delegation or final readiness/merge action. Root keeps PR #88 as the sole draft and owns the same original reviewers' independent confirmation. This report does not claim that follow-up confirmation complete.

## Exact changed paths

```text
apps/cli/src/actions/sync/remote_update_graph.ts
apps/cli/src/actions/sync/sync_maintenance.ts
apps/cli/src/actions/sync/sync_refresh.ts
apps/cli/test/commands/sync_numeric_branch_cli.test.ts
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/index.md
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-actual-cases.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-build.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-collect-cases.py
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-eslint.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-freeze-after-native.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-freeze-after-node.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-freeze-after-package.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-freeze-before.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-freeze.py
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-green-numeric-open.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-build.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-get-identity.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-get-number.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-get-stored.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-maintenance.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-numeric.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-owned.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-refresh.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-native-results.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-get-identity.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-get-number.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-get-stored.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-maintenance.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-numeric.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-owned.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-refresh.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-node-results.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-noemit.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-npm-artifact.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-npm-build.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-npm-gate-permitted.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-package-build.py
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-production-boundary.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-red-numeric-open.log
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-report.md
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-runner.py
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-source-artifacts.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/review-fixes-source-checks.json
docs/verification/sync-updates-evidence-2026-11-01/review-fixes/sha256.json
docs/verification/sync-updates-implementation-2026-11-01.md
```

## Final clean handoff

Anthracite MCP `modify --commit --message 'fix(sync): preserve numeric branch lookup identity [skip ci]'` created **`c7a1a6251bfd1a2f31727a0ad9e25bdc43398bc7`**. All45 intended paths were staged explicitly. Anthracite MCP Git passthrough `merge sync-updates --no-edit --message 'Merge sync-updates into sync-updates-review-fixes [skip ci]'` returned Already up to date; current integration2dc0c3d is an ancestor. Worktree/index are clean, full base→HEAD diff check passes, and post-commit/handoff frozen source/artifact verification passes. `review-fixes-git-evidence-check.json` verifies all56 original and39 corrected evidence manifest entries against exact Git-stored bytes. The older parent evidence index and SHA256 manifest remain unchanged and valid. The durable correction report captures the pre-commit source/artifact state; this final handoff appendix is retained outside the worktree.

No required acceptance remains running. Ready for the root-owned merger and same-original-reviewer independent confirmation, not for PR readiness/merge/release. The reserved implementer remains available for confirmed follow-up findings.
