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

The installation test uses an empty npm cache, offline installation and a temporary prefix containing spaces. It checks both command names, version, help, completion, get negative-option suggestions and package contents. The installed-artifact gate runs nine selected public Git/MCP scenarios through the installed executable: inspection, a literal staged commit, active/queued and numeric-zero cancellation, targeted insertion, two frozen-publication guards, one get learning/execution/protected-failure workflow, and one sync learning/execution/protected-failure workflow. The get scenario uses explicit scope/replay/checkout flags and independently compares actual Git state with direct CLI. The sync scenario explicitly uses no-pull/no-delete while keeping default maintenance: an incoming parent advance replays its editable child through the installed bundle’s owned hook/self-launch path, then staged dirt produces the normal protected error without mutation. It compares refs, checkout, index entries and files with direct CLI. GitHub responses are controlled fixtures; remotes are local bare repositories. The historical [get candidate verification](verification/get-updates-implementation-2026-10-31.md) records source/artifact identities and its own review boundary; public 0.5.1 did not ship those get or sync updates. The historical [sync candidate verification](verification/sync-updates-implementation-2026-11-01.md) records the assembled source/native and exact tarball boundaries. No active installation, shell configuration or MCP registration changes. No live GitHub changes are made.

See [implementation verification](verification/npm-distribution-2026-10-28.md) for the retained artifact-level evidence and local validation limits. See [channel implementation acceptance](verification/beta-stable-channels-2026-11-04.md) for the controlled release matrix, exact reused artifacts, and the single installed MCP channel-switch check.

## Release automation

`release-please-config.json` tracks `apps/cli` and its version, starting from the last standalone release, `v0.1.1`. Conventional commits affecting the CLI or root tooling feed a release PR and English changelog. Tags remain `v<version>` rather than acquiring a component prefix. A release PR updates the CLI manifest and `.release-please-manifest.json`; the root workspace has no version.

Main pushes run release-please preparation only: a release PR, stable tag or GitHub release prepares a possible release and never publishes npm automatically. Keep the checked-in stable manifest and pinned manifest-mode release-please action. Beta staging changes the CLI version only in disposable source; it does not update the stable manifest. Canonical beta evidence releases therefore do not replace the stable release boundary selected by that manifest.

Publication requires manual dispatch of `.github/workflows/release.yml` from `main`. The initial `select` operation is nonpublishing and refuses. `NPM_TRUSTED_PUBLISHING` must equal literal `true`; false or unset refuses. The existing npm trusted publisher remains owner **danielbaars**, repository **anthracite**, workflow **release.yml**, no environment, direct publication with OIDC and provenance. No persistent npm write token or tag-management permission is needed. Only the publishing job has `id-token: write`; its `contents: write` retains durable release assets. The preparation job retains its release-please contents/PR permissions.

Both jobs share the `release` concurrency group with `cancel-in-progress: false`. Preparation has a five-minute limit; manual publication has a ten-minute limit. The process installs locked dependencies, builds/lints/typechecks and tests the exact intended tarball through the established gates. It neither starts the full matrix nor compiles native releases. Run relevant focused local checks for release changes; the standalone release gate remains separate.

Use the [direct targeted patch route](#direct-targeted-patch-releases) for narrowly scoped bugfixes. The beta/promotion procedure below remains for features and broader changes.

### Manual beta and stable inputs

Use the Actions `Release` dispatch form or `gh workflow run release.yml --repo danielbaars/anthracite --ref main` with the following literal fields. The commands below are operational examples, not authorization to publish during implementation.

| Input          | Beta operation                                              | Stable operation                         |
| -------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `operation`    | `beta`                                                      | `stable`                                 |
| `beta_source`  | Exact lowercase full 40-character main-history SHA          | Omit                                     |
| `beta_version` | Canonical `X.Y.Z-beta.N`, positive N without leading zeroes | Exact selected immutable beta version    |
| `stable_tag`   | Omit                                                        | Existing canonical `vX.Y.Z` tag/release  |
| `practice`     | Omit                                                        | `release:v<selected beta>/practice.json` |
| `confirmation` | Omit                                                        | Intended stable version without `v`      |

For an owner-approved beta source/version:

```sh
gh workflow run release.yml --repo danielbaars/anthracite --ref main \
  -f operation=beta -f beta_source="$APPROVED_BETA_SOURCE" \
  -f beta_version="$APPROVED_BETA_VERSION"
```

The process records the source once and verifies repository/main membership. Stable derives its version and source from the existing stable tag, verifies its target matches the selected beta, and detects later tag movement. It requires separate explicit confirmation, not an approval inherited from a release PR or previous run:

```sh
gh workflow run release.yml --repo danielbaars/anthracite --ref main \
  -f operation=stable -f beta_version="$SELECTED_BETA_VERSION" \
  -f stable_tag="v$APPROVED_STABLE_VERSION" \
  -f practice="release:v$SELECTED_BETA_VERSION/practice.json" \
  -f confirmation="$APPROVED_STABLE_VERSION"
```

Set these variables only to reviewed concrete identities; the example does not choose a candidate. Unknown, absent, contradictory or malformed inputs refuse. The triggering maintainer must match the practice asset uploader and its recorded approving maintainer; retries retain both original and triggering actors.

### Practice record and source equivalence

First install and verify the exact beta using [the installation guide](installation.md), then exercise synthetic stacks before normal use. Normally record two or three working days. An intentionally shorter period needs a nonempty `shorterPeriodJustification` explaining the decision; elapsed time alone never approves a release. Retain outcomes for all six scenario IDs below. The first two must pass, with synthetic practice preceding daily use. Exercise applicable merged-parent/unpublished-work, external trunk advancement, genuine conflict/continuation and interruption/resumption cases. A genuine `not-applicable` outcome requires a specific `reason`; failed scenarios block stable. Record every finding with `id`, boolean `blocking` and `resolved`, and a nonempty `disposition`; unresolved blocking findings refuse.

Download the exact selected beta's durable `intent.json`, `SHA256SUMS` and tarball into an empty directory before preparing the record. Verify the checksum, package version and installed version; copy source and artifact integrity from that validated intent and calculate the SHA256 of its unchanged bytes. Do not derive these values from the moving beta tag or another local build.

```sh
gh release download "v$SELECTED_BETA_VERSION" --repo danielbaars/anthracite \
  --pattern intent.json --pattern SHA256SUMS --pattern danielbaars-anthracite.tgz
shasum -a 256 -c SHA256SUMS
shasum -a 256 intent.json
```

Schema 1 requires `package`, `repository`, `betaVersion`, full `source`, `artifactIntegrity`, `intentSha256`, UTC ISO `startedAt`/`endedAt`, nonnegative integer `workingDays`, `platform` (`os`, `arch`, `node`), boolean `rewritesChanged`, `scenarios`, `findings` and `maintainer` (`login`, `disposition`, `notes`). Each passed scenario needs `performedAt` within the practice period and retained outcome `notes`. Dates cannot be in the future; working days must agree with the interval. The following copyable JSON is deliberately an **unapproved draft**, not passing evidence. Replace all identity/date/outcome placeholders with actual observations; never change disposition merely to satisfy a gate.

```json
{
  "schema": 1,
  "package": "@danielbaars/anthracite",
  "repository": "danielbaars/anthracite",
  "betaVersion": "0.7.0-beta.1",
  "source": "REPLACE_WITH_EXACT_BETA_SOURCE_SHA",
  "artifactIntegrity": "REPLACE_WITH_INTENT_ARTIFACT_INTEGRITY",
  "intentSha256": "REPLACE_WITH_SHA256_OF_UNCHANGED_INTENT",
  "startedAt": "2026-11-04T09:00:00Z",
  "endedAt": "2026-11-06T17:00:00Z",
  "workingDays": 3,
  "platform": {
    "os": "RECORD_OS",
    "arch": "RECORD_ARCH",
    "node": "RECORD_VERSION"
  },
  "rewritesChanged": true,
  "scenarios": [
    {
      "id": "synthetic-stacks",
      "outcome": "failed",
      "performedAt": "2026-11-04T09:00:00Z",
      "notes": "Pending actual synthetic exercise"
    },
    {
      "id": "daily-use",
      "outcome": "failed",
      "performedAt": "2026-11-06T17:00:00Z",
      "notes": "Pending actual personal use"
    },
    {
      "id": "merged-parent-unpublished-work",
      "outcome": "failed",
      "notes": "Pending applicable scenario"
    },
    {
      "id": "trunk-advance",
      "outcome": "failed",
      "notes": "Pending applicable scenario"
    },
    {
      "id": "conflict-continuation",
      "outcome": "failed",
      "notes": "Pending applicable scenario"
    },
    {
      "id": "interruption-resumption",
      "outcome": "failed",
      "notes": "Pending applicable scenario"
    }
  ],
  "findings": [
    {
      "id": "practice-pending",
      "blocking": true,
      "resolved": false,
      "disposition": "Complete and review the recorded scenarios"
    }
  ],
  "maintainer": {
    "login": "RECORD_APPROVING_LOGIN",
    "disposition": "draft",
    "notes": "No stable approval recorded"
  }
}
```

After completing/reviewing actual evidence, the maintainer may explicitly set `disposition` to `approved` with substantive notes. Save the final record as `practice.json`, review it for synthetic data and summarized outcomes only (no credentials/private project content), and upload it using that maintainer's authenticated account to the **exact selected beta release**:

```sh
node -e 'JSON.parse(require("node:fs").readFileSync("practice.json", "utf8"))'
gh release upload "v$SELECTED_BETA_VERSION" practice.json --repo danielbaars/anthracite
```

Do not use `--clobber` or replace existing evidence silently. Inspect an existing conflicting asset before proceeding. The stable `practice` reference is exactly `release:v$SELECTED_BETA_VERSION/practice.json`; arbitrary URLs are rejected. Stable snapshots its approved bytes/digest and uploader identity alongside the selected beta record/proof.

Stable compares the complete tracked source tree, including paths, entry types and modes. Only the CLI manifest's version field, that package's release-please manifest version field and the generated CLI changelog contents are normalized. Other code, dependencies, lockfiles, tests, documentation, packaging, workflows or tools require another beta. Actual dispatcher release-process files/modes, workflow and recorded Node/Yarn/Bun/npm versions must also match. Stable is built/tested separately with its stable version: its tarball differs from beta, and moving beta bytes to `latest` cannot create a stable package. No bypass, token fallback or standalone tag repair is supported.

### Durable evidence, retries and operator decisions

Before a publish attempt, version-tagged GitHub release assets retain immutable `intent.json`, the exact `danielbaars-anthracite.tgz`, `SHA256SUMS` and `tests.json`. Beta uses a prerelease bound to the captured source tag; stable uses the existing stable release. Stable also retains assessment, practice and selected-beta snapshots. These durable assets survive short-lived Actions artifacts. A prepared release or retained intent means preparation succeeded, not npm publication.

Each authorized write appends `attempt-<run>-<attempt>.json` identifying its actual dispatcher/run. Successful proof appends `verification-<run>-<attempt>.json`; failed or uncertain effects retain `observation-<run>-<attempt>.json`. Original intent, tested bytes and producer identity remain immutable. npm provenance identifies the actual publishing dispatcher; the retained record binds selected source and version staging. A later retry is never relabelled as the original producer.

Retention reads the exact release-tag resource instead of relying on visibility in the release inventory. New-release and asset verification allow five readback attempts with one-second pauses between them. These waits repeat only reads; they never recreate a release or repeat an upload. Access failures, conflicting bytes and changed source or prerelease identities still refuse immediately. Unavailable initial evidence blocks npm publication. Later readback failures preserve reached effects and require inspecting release and npm state before retrying.

Inspect the summary's channel/version/source, selected immutable beta, source-equivalence result, artifact integrity, retained checks, practice disposition, actual tags, confirmed writes and precise next action. Retained passing checks are not evidence that a retry rebuilt or reran them. Beta must preserve observed `latest`; stable must preserve observed `beta`. Unexpected mappings fail completion and are reported without automatic repair.

| Reached state                                                                       | Next action                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refused before a publish request                                                    | Correct the stated gate; no npm publication is implied. Preserve evidence.                                                                                                          |
| Definite registry rejection or verified absence                                     | Inspect the retained attempt. Only a fresh explicitly authorized run/attempt may reuse the exact validated original artifact; never rebuild/reuse the version with different bytes. |
| Lost response, visible version without complete proof, or propagation deadline      | Preserve records and inspect fresh public state. The bounded visibility window is up to five minutes; uncertainty never authorizes a blind second write.                            |
| Existing version with matching intent, bytes, provenance and intended mappings      | Read-only reconciliation can finish verification with zero npm writes. It preserves the original actual publishing identity.                                                        |
| Conflicting permanent version/tag/asset, missing original bytes or mismatched proof | Stop and inspect. Do not republish that version, overwrite assets, move/delete tags, unpublish, or delete recovery state.                                                           |

The owned local lock and shared workflow serialization protect owned operations, not unrelated npm publishers; no atomic registry compare-and-swap is promised. Preserve a foreign/stale lock and inspect its owner rather than deleting it. Reconciliation rechecks fresh state and source/tag identities and makes no automatic channel reversal.

### First live manual OIDC beta acceptance — future, separately approved

Local controlled release/install tests do not establish public beta availability or certify the first live manual dispatch. After review and merge, obtain owner approval for exactly one full main-history source SHA and one canonical beta version. Do not infer stable approval from this beta acceptance.

1. Record the actual public `latest`/`beta` mappings and `latest` integrity with `npm view @danielbaars/anthracite dist-tags --json` and `npm view @danielbaars/anthracite@latest dist.integrity --json`. Record the approved source/version and dispatcher identity.
2. Run only the approved manual beta dispatch above from `main`. Retain the real Actions run/attempt URL, actors, exact source and tool/process identities, durable intent/tests/attempt/artifact and final verification. A timeout/prepared release is not success.
3. Read public exact-version metadata, download its tarball and compare SHA256/SHA512 integrity to the retained tested artifact. Verify registry signatures/provenance cryptographically and the certificate's exact trusted release-workflow/main identity, actual publishing dispatcher/run and selected-source record. Do not accept only a provenance payload's self-asserted repository fields.
4. Re-read actual tags: `beta` must select that version and `latest` plus its integrity must remain unchanged. Stop on disagreement; do not repair tags.
5. Install the exact public candidate in a temporary prefix with isolated HOME, npm cache/config and GitHub/config directories. Verify both aliases' real paths, versions/help, regenerate/source zsh completion after `compinit` and register both names as in the installation guide. Discover/execute through the existing MCP client, close the connection before the switch, and restart/reconnect to the selected executable. Preserve host configuration sentinels; do not change the user's active installation or client registration.
6. Record actual observations and any uncertain stage. Only after synthetic testing and recorded practice may a maintainer separately approve exact stable publication with matching source equivalence and confirmation.

### Historical account bootstrap

The scoped package `@danielbaars/anthracite` and trusted publisher already exist; the unscoped `anthracite` name belongs to another project. Public 0.6.9 predates this channel workflow. Initial owner-account bootstrap used the generated tested tarball, local account/2FA and public access before configuring the `release.yml` trusted publisher. That initial manual publication had no GitHub OIDC provenance; later automated publications use OIDC. This history does not instruct a new bootstrap, login, token creation or repository-setting change for channel rollout. A read-only cryptographic inspection of the existing public package also does not constitute first live manual beta acceptance.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), [release-please action](https://github.com/googleapis/release-please-action).

## Retain local delivery-test artifacts

For a fresh-checkout controlled manual beta/stable run, set
`ANTHRACITE_EXPORT_DELIVERY_ARTIFACTS` to an explicit new absolute output directory
when running the focused manual-dispatch test. The successful group exports the
real built/tested archives and original durable records before fixture cleanup.
The checked-in `scripts/export-release-artifacts.cjs BETA_ASSETS STABLE_ASSETS OUTPUT`
command also accepts an existing complete retained pair and generates the delivery
metadata without private fixture paths. It refuses missing, tampered or conflicting
inputs/output; it never replaces foreign files. Follow the exact install/build,
export and isolated consumer commands in the
[reproduction procedure](verification/beta-stable-channels-2026-11-04.md#reproduction-and-public-seams).
These local captured external-service records do not certify live npm/OIDC or
personal-use acceptance. No publication or active installation is needed.

## Direct targeted patch releases

Use a direct patch for narrowly scoped bugfixes with focused regression tests and review. Features and broader behavior changes still use beta practice and the stable promotion route. This is an explicit maintainer choice, not a classification inferred from commit titles.

After merging the release-please PR, the stable GitHub tag and CLI manifest must match. The version must be exactly one patch newer than npm `latest` (for example, 0.6.9 to 0.6.10). Provide the exact version confirmation and a substantive bugfix justification:

```sh
gh workflow run release.yml --repo danielbaars/anthracite --ref main \
  -f operation=patch \
  -f stable_tag=v0.6.10 \
  -f confirmation=0.6.10 \
  -f patch_reason="Targeted submit footer repairs; focused regressions and review passed."
```

Omit beta source/version and practice inputs. No beta or personal-use evidence is claimed. The workflow retains the patch decision, actor and exact source, builds and tests the stable tarball, publishes that exact artifact through OIDC to `latest`, and verifies signatures/provenance and unchanged `beta`. Reconciliation reuses retained bytes and never silently rebuilds or republishes an existing version. Repository identity, main ancestry, immutable tag, artifact and publication guards still apply. This operation does not start the full CI matrix or change a user's installation.

## npm installation propagation

After npm accepts a publication, the exact-version endpoint can become visible before npm install metadata. An `ETARGET` response during isolated readback uses the existing bounded public-verification retry budget (five minutes). Retries repeat reads, installation and signature/provenance verification; they do not repeat publication or reset the deadline. Authentication and integrity errors still stop immediately. Exhausting the budget retains the original publication evidence for deliberate reconciliation.
