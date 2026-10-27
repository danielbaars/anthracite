# Contributing

Please open an issue before a substantial change. Use English for source comments, documentation, commit messages, issues and pull requests. Preserve upstream attribution and compatibility with existing stacks.

## Build

Use Node.js 24.19.0 (`nvm use`), the checked-in Yarn 3.2.1 release and Bun 1.3.14 for native release builds. No global Yarn or Turbo installation is needed.

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

Automatic `CI` runs on pull-request updates and pushes to `main`. It runs one Linux Node job: build/lint, typecheck and eight smoke-test files covering release identity, branch creation/checkout, short log and the zero-depth log regressions. The ten-minute job timeout bounds runner execution to approximately $0.06 at the current [standard Linux rate](https://docs.github.com/en/billing/reference/actions-runner-pricing) of $0.006/minute, before included usage. Actual duration varies. This is a smoke check, not complete regression acceptance.

Documentation-only changes (`**/*.md`, `docs/**` and `LICENSE`) skip automatic CI. Mixed code/documentation changes still run it. If required checks are introduced, account for GitHub leaving path-filtered workflows pending; do not require an absent check for documentation-only changes.

Developers must run tests relevant to their changes locally on both runtimes. After building, the smoke selection can also be run locally with the same runner:

```sh
TEST_SHARD=0 TEST_SHARDS=1 \
TEST_FILTER='commands/(anthracite_identity_cli|branch/branch_(create|checkout)|log/short|log_steps_(full|short|state|options)_cli)\.test\.js$' \
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite test-ci
```

`Full validation` (`.github/workflows/full-ci.yml`) has **only** a manual trigger. Run it deliberately on the intended branch/commit before final acceptance; it runs the complete Node and native suites in eight jobs. Recent full runs used approximately 170 runner-minutes (about $1.02 gross); its eight 45-minute job limits allow up to 360 runner-minutes (about $2.16 gross). These are runtime estimates, not billing guarantees, and exclude storage. Review the estimate and available budget before dispatching it. The workflow must first exist on the default branch for GitHub to expose its manual trigger.

The optional `release_assets` input defaults to false. Enable it only for release validation; it adds a job to build the three platform binaries and test installation, with a 20-minute limit (approximately $0.12 additional runner cost at that rate). It does not publish a release.

Both workflows cancel superseded runs on the same ref. The full matrix stops remaining jobs after a failure. Test and asset artifacts expire after seven days. No scheduled full runs or automatic release builds are configured. Workflow syntax can be checked locally with `actionlint`.

## Run and install a development build

```sh
node apps/cli/dist/src/index.js --help
sh apps/cli/scripts/installation/develop.sh
```

The development installer uses separate versioned `-dev.<timestamp>` directories. It does not uninstall another CLI or replace a versioned release directory.

## Prepare a release

After the build and tests pass, compile release binaries and checksums with:

```sh
sh scripts/build-release.sh release
```

Manually run `Full validation` with `release_assets` enabled to test the source and Linux native CLI and upload the three platform binaries with their checksums, license and credits. Before tagging a version, confirm this full release validation passed for the exact commit, verify installation from those assets in a fresh HOME, and smoke-test the macOS ARM64 binary on that platform. A green automatic smoke check alone does not satisfy this release gate. Publish the matching `v<version>` tag and GitHub release assets together. Do not publish the private workspace package to npm.

Original commit history and historical external research references are retained as provenance. New work belongs in this repository's issue tracker.
