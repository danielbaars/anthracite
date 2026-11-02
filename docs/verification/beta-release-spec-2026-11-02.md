# Beta and stable release specification: basis and validation

Date: **2 November 2026**. The owner approved the scope and primary test boundary before this specification. See the [full specification](../specs/beta-release-channels.md), [approval summary](evidence/beta-release-spec-2026-11-02/approved-boundary.json) and [source identity index](evidence/beta-release-spec-2026-11-02/source-basis.json).

This is a documentation-only delivery. It neither implements a release route nor publishes a beta, changes npm tags, modifies an installation, starts CI or runs the full matrix. The future first real OIDC beta requires separate explicit approval. New process/artifact tests and practical beta use described by the spec have not yet been performed.

## Current release boundary

The inspected baseline is [merged main `64d82c8a`](https://github.com/danielbaars/anthracite/tree/64d82c8a00e7ba97f81ddda2f82f0cca2604606b), released as [0.6.5](https://github.com/danielbaars/anthracite/releases/tag/v0.6.5). The working [stable release run](https://github.com/danielbaars/anthracite/actions/runs/41473787817) supports retaining the current OIDC relationship; it does not prove manual-dispatch or beta behavior.

The source index records SHA-256, byte count, exact commit and immutable GitHub URL for seven relevant files. These are bounded source observations, not whole-program runtime certification:

| Current observation                                                                                       | Evidence                                            | Consequence for the specification                                                                                        |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Release responds to main pushes and has no manual dispatch.                                               | Baseline release workflow.                          | Add manual channel selection while retaining release preparation.                                                        |
| Release-please creates stable version/tag state; the publishing job follows release creation.             | Baseline workflow and release-please configuration. | Separate stable preparation from deliberate npm publication.                                                             |
| npm publish has no explicit tag, so its documented default is latest.                                     | Baseline workflow plus npm dist-tag documentation.  | Require explicit beta/latest selection and independent readback.                                                         |
| Publication uses OIDC and provenance behind the existing repository flag.                                 | Baseline workflow and completed stable run.         | Retain this relationship rather than add a token or a second workflow identity.                                          |
| The builder reads the CLI version and creates a curated tarball; tests install and execute that artifact. | Baseline builder and package checks.                | Stage only the beta version in a disposable source copy and reuse exact-artifact validation.                             |
| Prepared tarballs have seven-day Actions retention.                                                       | Baseline workflow.                                  | Add durable release evidence before publication; expiring runner artifacts cannot be the only promotion/recovery source. |
| Preparation and publication have five- and ten-minute limits.                                             | Baseline workflow.                                  | Preserve bounded jobs; adjust only on measured need rather than introducing the full matrix.                             |

The [read-only registry observation](evidence/beta-release-spec-2026-11-02/registry-baseline.json) records `latest` pointing to 0.6.5 and no beta tag at observation time. It preserves the existing stable package integrity and attestation location. Registry tags can change later; this observation is not a permanent assertion about live state.

## Platform facts and sources

- npm publication uses latest by default; an explicit beta tag selects another channel. This is why a prerelease version suffix alone is not this project's release policy. [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- A published package/version identity cannot be reused. Recovery must reconcile existing bytes instead of publishing a rebuild under the same identity. [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- Trusted publication binds a workflow identity. Standalone dist-tag management has a separate permission, and public tag reads do not need it. The design retains direct publication with an explicit tag and adds no tag-repair privilege. Its first real dispatch still needs live validation. [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- GitHub manual workflow execution uses workflow dispatch, with the workflow present on the default branch. Our additional repository/source/ref restrictions are product decisions. [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

These references were checked on the date above. They do not prescribe the practice period, stable approval, source normalization or evidence schema; those are the approved Anthracite design.

## Selected design and limits

**Release policy.** One main branch remains sufficient. Feature and version preparation are distinct from public npm publication. Manual beta publication leaves latest intact; manual stable publication selects an exact beta, accepted practice record and separately built stable version. No emergency bypass is silently added, including for the release tooling's own first version.

**Source identity.** Compare complete tracked source identity, preserving file modes/types and all manifest fields except the specifically normalized version values. Only generated CLI changelog contents receive the separate release-metadata exception. Dependency edits in the same package manifest must fail equivalence. Also bind the actual executing dispatcher, process code and toolchain; checking out a previously tested tag cannot hide new workflow behavior on main. The declared version, channel and approval inputs differ by operation. Stable and beta packages have different versions, so raw tarball equality between channels is not a valid promotion test. Exact tested-to-published tarball equality within each version remains required.

**Durability and uncertainty.** Preserve intent, tarball and checksum as durable canonical version-release evidence before registry publication. Separate immutable intent from later run/attempt and completion records. A delayed registry response, failed final evidence upload or unexpected external tag movement can leave a real publication whose verification is incomplete. Report that reached state, retain evidence and reconcile; do not automatically publish again, unpublish or reset tags. Shared concurrency serializes our own operations, not all external npm publishers.

**Practice.** The normal recommendation is synthetic exercises followed by two or three working days of actual use. The acceptance decision names the exact candidate and applicable scenarios, including history/recovery boundaries for changed Git-rewriting commands. It is not a timer-based safety guarantee or a new calendar service. A shorter period requires an explicit explanation, while required scenario evidence and release-blocking findings remain authoritative.

**Installation.** Switching channels uses the existing global package commands. Tests use isolated prefixes and configuration. Documentation must distinguish an updated executable on disk from an MCP process that still needs restarting, and a package downgrade from undoing Git effects. No automatic owner-environment migration belongs to this work.

## Approved test boundary

The primary seam is the release process invoked by the workflow, tested as an actual process. Real temporary Git histories and npm tarballs/installations cover source comparison and artifact behavior. GitHub/registry replies and publication effects are controlled at their external boundaries. Existing exact-tarball and installed Git/MCP checks are reused.

Focused coverage must include both channels, malformed/foreign inputs, source differences and allowed version-only changes, changed executing workflows, practice approval, artifact mutation, delayed/uncertain publication, read-only duplicate reconciliation, tag preservation and concurrency. Assertions inspect resulting records, actual Git/package state and observed external writes. Helper-unit tests or YAML string checks alone cannot establish these outcomes.

No real publication, live GitHub fixture change, owner-installation change, ordinary CI or full matrix is authorized by the local-test boundary. The future first manual OIDC beta is a separate owner-approved live acceptance, not an inferred consequence of creating this issue or merging implementation code.

## Documentation checks

The retained [validation record](evidence/beta-release-spec-2026-11-02/validation.json) records checks of the seven-section to-spec template, numbered user stories, forbidden implementation file-path/code-snippet details, source hashes, local links/anchors, JSON evidence and documentation-only change scope. Link and hash checks validate this specification delivery, not the proposed release implementation. The record is produced before committing; it does not hash itself.

The issue body is generated from the same specification after its documentation commit is pushed, replacing local references with immutable GitHub file URLs. No issue links to an unpublished local path. No PR, implementation, npm publication or workflow dispatch is part of this delivery.
