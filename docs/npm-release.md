# npm distribution and release operations

The development workspaces remain private. Never run `npm publish` in the repository root or `apps/cli`. Only the generated, tested tarball is publishable.

## Artifact and local verification

Use the pinned tools in [CONTRIBUTING.md](../CONTRIBUTING.md): Node 24.19.0, Yarn 3.2.1 and Bun 1.3.14.

```sh
node .yarn/releases/yarn-3.2.1.cjs install --immutable
node .yarn/releases/yarn-3.2.1.cjs turbo run build
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite check
node scripts/build-npm-package.cjs
node scripts/test-npm-package.cjs
```

`BUN_EXECUTABLE` may identify an existing Bun executable. The builder produces a versioned tarball, a stable `release/npm/danielbaars-anthracite.tgz` copy and `SHA256SUMS`. It bundles the CLI and its installed dependencies, including the checked-in SDK cancellation patch, from disposable source copies. Those copies disappear before testing, exposing accidental references to the build machine. Consumers need Node 24+ and Git; PR workflows also need an authenticated `gh`. They do not need Yarn or Bun.

The generated package has no runtime dependencies, lifecycle scripts or development workspace fields. It includes both commands, README, the inherited license and credits, and notices collected from actual bundled dependencies. The builder refuses bundled dependencies without license text. The legacy `graphite-cli-routes` package declares `None` and is excluded from the runtime bundle: Anthracite defines its PR-cache data shape locally with the same fields, types and optional review decision. Type-only legacy references remain development inputs and do not enter the executable.

The installation test uses an empty npm cache, offline installation and a temporary prefix containing spaces. It checks both command names, version, help, completion and package contents. It then runs existing public Git/MCP scenarios through the installed executable: read-only inspection, a staged commit with literal arguments, active/queued cancellation with numeric request ID zero, and a real pre-push guard against a local bare remote. GitHub responses in that guard scenario are controlled fixtures. An existing editable-child/frozen-base publication scenario verifies nonempty PR information still survives local cache/readback through the installed artifact. No active installation, shell configuration or MCP registration changes. No live GitHub changes are made.

See [implementation verification](verification/npm-distribution-2026-10-28.md) for the retained artifact-level evidence and local validation limits.

## Release automation

`release-please-config.json` tracks `apps/cli` and its version, starting from the last standalone release, `v0.1.1`. Conventional commits affecting the CLI or root tooling feed a release PR and English changelog. Tags remain `v<version>` rather than acquiring a component prefix. A release PR updates the CLI manifest and `.release-please-manifest.json`; the root workspace has no version.

The `Release` workflow runs on `main` only. Release creation selects the exact release SHA, verifies its tag against the CLI version, installs locked dependencies, builds/lints/typechecks, and builds and tests the npm tarball. It preserves that exact tarball and checksum as the `npm-release` Actions artifact for seven days. Publication uses that same tarball, OIDC and provenance; no persistent npm write token is configured. `NPM_TRUSTED_PUBLISHING=true` must be enabled as a repository variable only after account bootstrap below. Until then the workflow validates releases and saves their artifact, without publishing.

GitHub must allow Actions to create pull requests. The workflow grants write permissions only to the release-please job; the publishing job has read-only contents and `id-token: write`. A release PR created with `GITHUB_TOKEN` does not trigger other workflows automatically. Before merging it, dispatch the cheap `CI` workflow on its branch and confirm the head SHA. Do not dispatch `Full validation` for npm publication.

Normal pushes run the existing single cheap CI job, with the additional artifact check. `Release` has a five-minute preparation limit and a ten-minute publication limit. Neither workflow starts the full matrix or compiles native releases. Existing standalone asset release gates remain separate.

## One-time account bootstrap

The scoped name is `@danielbaars/anthracite`; the unscoped `anthracite` name belongs to another project. npm trusted publishers require an existing package. Bootstrap the first release using the owner account; keep credentials and 2FA responses out of issues and chat.

1. Merge the implementation PR, review the release-please PR and run its cheap CI. Merge the release PR when ready to publish. Leave `NPM_TRUSTED_PUBLISHING` unset for this first release.
2. Find that release's successful `Release` workflow run. Download its tested artifact into an empty directory with `gh run download <run-id> --repo danielbaars/anthracite --name npm-release`. Check `shasum -a 256 -c SHA256SUMS` and inspect the package version with `tar -xOf danielbaars-anthracite.tgz package/package.json`.
3. Authenticate locally with `npm login`, check `npm whoami` is the intended owner, then run `npm publish ./danielbaars-anthracite.tgz --access public`. Complete npm's account/2FA prompt locally. This initial manual publication has no GitHub OIDC provenance; subsequent automated publications do.
4. In that package's npm settings, add a GitHub Actions trusted publisher: owner **danielbaars**, repository **anthracite**, workflow **release.yml**, and no environment (the workflow uses none). Allow **direct publication**, rather than the staged-only default, for the workflow's `npm publish`. Configure this shortly before the next release: npm requires a new publisher's first use within two days.
5. Enable publication with `gh variable set NPM_TRUSTED_PUBLISHING --body true --repo danielbaars/anthracite`. After the next release, verify the npm version, both command names from a fresh install, and the registry provenance linking the expected repository/commit/workflow. Remove obsolete npm write tokens once the trusted publisher has worked.

Never republish a version that already exists. A failed publication after successful bootstrap should be investigated before rerunning its failed job; inspect the registry first because a registry write may succeed before a network response is lost. Download the saved tarball for diagnosis or recovery instead of rebuilding different bytes under the same version. If the artifact expires, rebuild from the immutable release tag and rerun the isolated tests before a manual recovery publication.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), [release-please action](https://github.com/googleapis/release-please-action).
