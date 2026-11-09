# Contributing

Please open an issue before a substantial change. Use English for source comments, documentation, commit messages, issues and pull requests. Preserve upstream attribution and compatibility with existing stacks.

## Build

Use Node.js 24.19.0 (`nvm use`), the checked-in Yarn 3.2.1 release and Bun 1.3.14 for npm bundles and native release builds. No global Yarn or Turbo installation is needed. The CLI pins TypeScript 5.5.4 and compatible Node.js declarations for the official MCP SDK 1.32.2; these declaration versions do not change the runtime requirements or CommonJS module format. TypeScript 4.7 cannot parse the SDK's Zod 4 declarations.

The checked-in Yarn patch for SDK 1.32.2 fixes its cancellation guard rejecting a valid request ID of numeric zero (or an empty string). It changes only that guard in the SDK's CommonJS and ESM protocol implementations; SDK validation, cancellation controllers and response suppression remain authoritative. Remove the patch when upgrading to an SDK that accepts every schema-valid request ID, and retain the public numeric-zero cancellation regression on both runtimes.

```sh
node .yarn/releases/yarn-3.2.1.cjs install --immutable
node .yarn/releases/yarn-3.2.1.cjs turbo run build
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite check
```

## Test

```sh
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite test
```

The regular suite runs every file in a fresh process, using real local Git repositories and boundary fixtures. Manual full validation distributes the same files over four deterministic shards per runtime and preserves each JSON test report. It excludes only the separate large-repository benchmark, which clones external projects and is available through `test-large-repos`. Live GitHub tests are separate and require deliberate authorization for their remote changes.

For a focused file after building:

```sh
cd apps/cli
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/anthracite_identity_cli.test.js
```

Set `ANTHRACITE_TEST_BINARY` to an absolute native binary path to run command fixtures against that executable. The legacy `CHARCOAL_TEST_BINARY` override remains a fallback. `ANTHRACITE_TEST_EVIDENCE_DIR` enables fixture evidence output. On macOS, supply an existing TMPDIR when running PTY tests.

## CI cost controls

Automatic `CI` runs on pull-request updates and pushes to `main`. It runs one Linux Node job: build/lint, typecheck and twelve smoke-test files covering release identity, branch creation/checkout, short log and its parent edges, the zero-depth log regressions, submit footer repair and ancestor PR body freshness, plus fresh PR-state verification before deletion. It also builds the npm tarball and checks an isolated offline installation, real Git/MCP execution and numeric-zero cancellation. The twelve-minute job timeout bounds runner execution to approximately $0.07 at the current [standard Linux rate](https://docs.github.com/en/billing/reference/actions-runner-pricing) of $0.006/minute, before included usage. Actual duration varies. This is a smoke check, not complete regression acceptance.

Documentation-only changes (`**/*.md`, `docs/**` and `LICENSE`) skip automatic CI. Mixed code/documentation changes still run it. If required checks are introduced, account for GitHub leaving path-filtered workflows pending; do not require an absent check for documentation-only changes.

The same job separately runs the two representative submit discovery propagation cases (stale list and stale detail snapshots). The other seven propagation/protection cases remain in the focused local suite and manual full validation. The same job runs the fast release-service boundary regressions and three focused landing cases for optional failure, required failure and blocker-first presentation. The broader landing/recovery campaign remains local or manual. Real release-process build campaigns remain separate local/manual checks; ordinary CI does not publish npm packages.

A small public-CLI selection also checks reused-branch PR safety. These representative cases run against the isolated installed npm artifact as well; the broader reused-branch acceptance campaign remains a targeted local check.

Legacy cleanup-recovery cases use an unmodified record produced by public npm 0.6.11. Ordinary CI installs that exact producer into `RUNNER_TEMP`. For local runs, set `ANTHRACITE_TEST_LEGACY_BINARY` to an absolute 0.6.11 executable path; legacy-only cases are explicitly pending without it. The installed-artifact check itself remains offline: the legacy producer is supplied before that check.

Developers must run tests relevant to their changes locally on both runtimes. After building, the smoke selection can also be run locally with the same runner:

```sh
TEST_SHARD=0 TEST_SHARDS=1 \
TEST_FILTER='commands/(anthracite_identity_cli|branch/branch_(create|checkout)|log/short|log_short_edges_cli|log_steps_(full|short|state|options)_cli|submit_(footer_repair|ancestor_footer)_cli|delete_pr_state_cli)\.test\.js$' \
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite test-ci
```

`Full validation` (`.github/workflows/full-ci.yml`) has **only** a manual trigger. Run it deliberately on the intended branch/commit before final acceptance; it runs the complete Node and native suites in eight jobs. Recent full runs used approximately 170 runner-minutes (about $1.02 gross); its eight 45-minute job limits allow up to 360 runner-minutes (about $2.16 gross). These are runtime estimates, not billing guarantees, and exclude storage. Review the estimate and available budget before dispatching it. The workflow must first exist on the default branch for GitHub to expose its manual trigger.

The optional `release_assets` input defaults to false. Enable it only for release validation; it adds a job to build the three platform binaries and test installation, with a 20-minute limit (approximately $0.12 additional runner cost at that rate). It does not publish a release.

Both workflows cancel superseded runs on the same ref. The full matrix stops remaining jobs after a failure. Test and asset artifacts expire after seven days. No scheduled full runs are configured. The separate `Release` workflow automatically prepares release-please metadata on main pushes. Only an explicitly selected manual beta or stable operation builds/tests/publishes an npm artifact; release-PR merges do not publish npm. It never starts the full matrix and serializes release operations without cancelling active publication. Workflow syntax can be checked locally with `actionlint`.

## Run and install a development build

```sh
node apps/cli/dist/src/index.js --help
sh apps/cli/scripts/installation/develop.sh
```

The development installer uses separate versioned `-dev.<timestamp>` directories. It does not uninstall another CLI or replace a versioned release directory.

## Prepare an npm release

Use conventional commit and squash-PR titles such as `feat(cli): ...` or `fix(cli): ...` so release-please can determine the version and changelog.

See [npm release operations](docs/npm-release.md) for the generated artifact, exact-tarball tests, release-please, OIDC, beta practice evidence and separate exact-version stable confirmation. The development workspaces remain private. Relevant local regression and exact installed-artifact checks remain required. Stable beta promotion additionally requires approved practice for one immutable beta and verified source equivalence. Explicit direct patch releases instead require the exact next patch and a recorded targeted-bugfix justification; a CI result or prepared release alone does not authorize publication. The native asset gate below does not apply to an npm-only release. Do not change the user's active installation during package verification.

## Prepare standalone release assets

After the build and tests pass, compile release binaries and checksums with:

```sh
sh scripts/build-release.sh release
```

Manually run `Full validation` with `release_assets` enabled to test the source and Linux native CLI and upload the three platform binaries with their checksums, license and credits. Before attaching standalone assets to a tagged release, confirm this full release validation passed for the exact commit, verify installation from those assets in a fresh HOME, and smoke-test the macOS ARM64 binary on that platform. A green automatic smoke check alone does not satisfy this release gate. For a new standalone version, use the matching `v<version>` tag created by release-please and attach the separately validated native assets to that GitHub release. An npm release alone does not assert that matching standalone assets exist. Never publish either private workspace directly to npm.

Original commit history and historical external research references are retained as provenance. New work belongs in this repository's issue tracker.
