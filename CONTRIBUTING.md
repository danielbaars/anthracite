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

The regular suite runs every file in a fresh process, using real local Git repositories and boundary fixtures. CI distributes the same files over four deterministic shards per runtime and preserves each JSON test report. It excludes only the separate large-repository benchmark, which clones external projects and is available through `test-large-repos`. Live GitHub tests are separate and require deliberate authorization for their remote changes.

For a focused file after building:

```sh
cd apps/cli
node ../../node_modules/mocha/bin/mocha.js dist/test/commands/anthracite_identity_cli.test.js
```

Set `ANTHRACITE_TEST_BINARY` to an absolute native binary path to run command fixtures against that executable. The legacy `CHARCOAL_TEST_BINARY` override remains a fallback. `ANTHRACITE_TEST_EVIDENCE_DIR` enables fixture evidence output. On macOS, supply an existing TMPDIR when running PTY tests.

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

CI tests the source and Linux native CLI and uploads the three platform binaries with their checksums, license and credits. Before tagging a version, confirm CI passed for the exact commit, verify installation from those assets in a fresh HOME, and smoke-test the macOS ARM64 binary on that platform. Publish the matching `v<version>` tag and GitHub release assets together. Do not publish the private workspace package to npm.

Original commit history and historical external research references are retained as provenance. New work belongs in this repository's issue tracker.
