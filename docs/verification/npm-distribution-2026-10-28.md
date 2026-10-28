# npm distribution verification

## Candidate and outcome

Issue [#35](https://github.com/danielbaars/anthracite/issues/35) was implemented on `npm-distribution`, relative to main `a5f2e88062160dd51033ac3715184cc495868d76`. The tested implementation is `06095e426cf46dc926d46c5e2ade70258bc624a1`. Its source version remains **0.1.1 for local validation only**; nothing was published under the existing standalone release version. Release-please will propose the first npm release version after integration.

On macOS ARM64, Node 24.19.0 and Bun 1.3.14, the real npm artifact passed offline installation in an empty-cache temporary prefix containing spaces. Both `an` and `anthracite` returned the expected version, help and completion. The package contained exactly the executable, generated manifest, README, inherited license, unchanged credits and third-party notices. It contained no dependency installation or lifecycle scripts. Its size was **465186 bytes** and SHA-256 was `2a5712913a38a244b367c399f5e93ae6cf1b8bcbe763889fe32fa99ec325e405`.

The existing public scenario selection passed **5/5 through the installed npm artifact, 5/5 through the normal Node build and 5/5 through the native binary**:

- Same-build MCP inspection, with PATH sentinels and independent Git-state checks.
- A real staged commit with literal Unicode and shell-looking arguments.
- Numeric-zero cancellation of active and queued MCP calls, retaining server usability.
- Existing nonempty PR-cache information while publishing an editable child on a frozen base and preserving unrelated PRs.
- A real pre-push hook freezing a branch before publication to a local bare remote; GitHub responses were fixtures.

The [summary and evidence hashes](evidence/npm-distribution-2026-10-28/summary.json) identify the exact artifact and unchanged retained logs. [Installed-artifact results](evidence/npm-distribution-2026-10-28/artifact-final.log), [Node controls](evidence/npm-distribution-2026-10-28/source-node.log) and [native controls](evidence/npm-distribution-2026-10-28/native.log) are retained separately.

## Failure caught before the fix

An initial artifact-only installation check passed, but did not establish self-launch isolation: Bun had embedded absolute build-source paths. Building from disposable source copies, removed before testing, exposed three failures in MCP execution/cancellation. The [red log](evidence/npm-distribution-2026-10-28/red-isolated.log) records those failures. The CLI now derives its self-launch command from the running installation and shares it with commit/push guards. The disposable-source boundary remains in the builder.

## Tooling checks and limits

The [build and lint](evidence/npm-distribution-2026-10-28/build.log), explicit no-emit typecheck, Prettier checks, `git diff --check` for source/tooling (excluding unchanged raw logs), `actionlint` and release-please JSON-schema validation passed. The schema validator ignored only the schema URL's URI-reference format annotation. No new testing or packaging dependency was installed. Raw stdout logs retain their original whitespace and final newlines.

The existing cheap CI retains one ten-minute Linux job and adds this bounded artifact test. The full matrix was not dispatched, native release assets were not cross-compiled, no live GitHub PR fixture was changed, and the user's active CLI, completion and MCP registration were not replaced. Linux execution and end-to-end OIDC publication remain to be verified after PR/release integration; local checks cannot prove them.

The repository is public. After explicit user approval, Actions can create/approve PRs, with default workflow permissions still read-only; the release workflow itself does not approve reviews. npm currently returns 401 for the local account and 404 for the proposed public package. Account login/2FA and the first-package bootstrap remain required. Automated publication stays off until `NPM_TRUSTED_PUBLISHING=true` is deliberately configured. See [release operations](../npm-release.md).

The builder refuses bundled dependencies without license text. Its [license-boundary red log](evidence/npm-distribution-2026-10-28/red-license.log) shows the legacy route package failing that gate. The runtime no longer imports that package: Anthracite defines the unchanged PR-cache field shape locally, while type-only references remain development inputs. The final bundled notices contain licensed `@withgraphite/retype@0.3.11` and exclude `graphite-cli-routes` and its extra runtime copy of retype. Existing PR information is covered by the additional installed-artifact scenario. The inherited LICENSE and CREDITS files remain byte-identical.
