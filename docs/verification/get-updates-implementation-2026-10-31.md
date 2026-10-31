# Scoped get candidate: local implementation verification

Date: **31 October 2026**. Baseline: public **0.5.1**, `5f76186bcfd2ee0952b9cb48bab1ddf94f00c3c5`. Candidate: `724e7d75228dbe7f9bd4b8f0a374c10cf3ff4098`, implementing the [approved specification](../specs/get-updates.md). See [the user guide](../get.md) and [compatibility recipe](../../COMPATIBILITY.md#scoped-get-candidate).

**Status:** source-qualified local checks below are complete. Independent Standards and Spec reviews and any resulting fixes remain pending. This is not approval, release readiness or functionality shipped in public 0.5.1. The temporary package deliberately retains version 0.5.1; hashes identify this source candidate. No version bump or publication occurred.

## Delivered scope

Get/g default to the required PR chain plus eligible locally tracked descendants, affected local maintenance after all incoming updates, and final target checkout. `--downstack` restricts remote refresh; `--no-restack` defers maintenance; `--no-checkout` restores original branch identity/current authorized head or exact detached OID on complete success. Necessary sibling maintenance is separate from refresh, and independent trunk stacks remain outside scope.

Trunk is FF-only, including with feature force. Validated identical/FF PR-parent transitions retain former parents. Ownership-based imports, frozen inbound status/anchors and local-file/worktree protection remain. Pinned sources, guarded publication and owned continuation retain parents, import choices, progress and final policy. Raw abort, foreign/stale intent and uncertain no-active-rebase publication require inspection; completed work is not rolled back or refs recreated. Get adds no cleanup, remote-only discovery, multi-trunk or sync feature-head refresh. [The guide](../get.md) defines the precise limits.

## Results and source boundaries

| Selection | Node | Native | Boundary |
| --- | --- | --- | --- |
| Initial assembled get selection | **190/205; 15 failed** | **190/205; 15 failed** | Frozen `4b44a313`; unchanged [raw receipts](evidence/get-updates-implementation-2026-10-31/README.md). These are negative integration evidence. |
| Corrected affected cases + five publication regressions | **20/20** | **20/20** | Exact merged `724e7d75`; 218.699s / 203.226s. |
| Exact modern get/g compatibility routes | **2/2** | **2/2** | Explicit `--no-restack`, retained head assertions; `4b44a313` production. |
| Sync/B02 and frozen-sync controls | **35/35** | **35/35** | `4b44a313` production. |
| Raw-Git/legacy continuation/restack | **12/12 executions** | **12/12 executions** | `4b44a313`; nine distinct reported titles. |
| Delivery and existing completion controls | **10/10** | **10/10** | `4ae61573` completion-only follow-up; three overlap assembled get. |

The initial failures were diagnosed before corrections: eight fixture/explicit compatibility/reason/manual-boundary adaptations; five genuine future-import/frozen-guard conflict failures; and two human phase-label mismatches. The reserved [core fix](evidence/get-updates-implementation-2026-10-31/reserved-fix-report.md), `046e85ad`, fixes the guard and post-publication consistency, restores phase labels and clarifies manual guidance. Its own **35/35** focused cases pass per runtime. Ordinary queued/mixed imports still complete; a concurrently tracked import instead refuses changed overwrite authority before staging while preserving editable actor state/content and recovery. This replaces one old assumption of collecting a new choice, not a new passing case.

The merged 20-case rerun covers all 15 affected cases plus five new publication/guidance cases. It preserves reached commits and hook-written metadata on late failure. The [original post-publication negative probe](evidence/get-updates-implementation-2026-10-31/pending-post-publication-probe.json) remains negative evidence on immutable #75; the corrected publication cases prove safe refusal, not forced restoration or rollback.

Across the explicitly selected, source-qualified receipts, **263 distinct current named cases have passing evidence per runtime: 118 new get cases and 145 existing controls**. This is not one 263-case run on a single revision. The [summary](evidence/get-updates-implementation-2026-10-31/summary.json) records exact source/group/case identities, the one replaced actor case and overlaps. An inherited literal scene title repeats three legacy names; those configured executions, repeated reruns and artifact checks are not inflated into new feature counts.

## Installed artifact and build identity

The exact merged temporary npm tarball passes the bounded **8/8** installed scenarios: the existing seven Git/MCP/numeric-zero/frozen-publication controls plus **one** new get scenario. It learns the same two tools, executes explicit scope/replay/checkout flags, compares actual Git refs/index/tree/physical checkout with direct CLI and returns a protected `cli_error` without changing staged work. Installed command names also expose negative completion suggestions. Earlier gates and direct Node/native executions repeat that scenario and are not added to distinct counts.

| Merged identity | SHA-256 |
| --- | --- |
| [CLI source/package/lock manifest](evidence/get-updates-implementation-2026-10-31/merged-source-manifest.sha256) | `aa39d08d92295dc4471e8775620c44a537a19a3f7683c5bc49d846355484ba05` |
| Native macOS ARM64 candidate | `7f9d3061fe08e7f7b12cd96610507428fa7b83b32472d6dce4c62602658e6c6f` |
| Temporary npm tarball | `ddb15307125688210f337db76449a3fac7b74099be82784fe03486393b2596ba` |

Node **24.19.0**, Yarn **3.2.1**, TypeScript **5.5.4**, Bun compiler **1.3.14**. Project build, uncached CLI source lint and no-emit check passed on the merged source. Runtime artifacts remained frozen during each run. The installer uses offline disposable HOME/config/cache/prefix containing a space and removes it afterward; the owner's installation is untouched. [Reproduction details, earlier artifact identities and unchanged receipts](evidence/get-updates-implementation-2026-10-31/README.md) are retained without committing binaries/tarballs.

## Evidence limits and remaining review

All feature checks use public CLI/real stdio MCP processes, real temporary Git repositories/bare remotes and strict controlled `gh`. Independent Git observations cover refs/ancestry/content, authors/messages, parents, physical HEAD, index/files and recovery. There is no new live GitHub/Graphite service, universal parity or cross-platform claim. Historical observations are not current feature passes.

The exact get/g modern-route filter excludes the independently public-0.5.1-confirmed stale unsupported-absorb sentinel. Its [original failure](evidence/get-updates-implementation-2026-10-31/baseline-modern-unsupported.json) is retained and **not** reported green. Explicit Mocha file/filter selection is used, never the known ineffective `an test` scope selectors.

CI, the full validation matrix, live fixture writes, GitHub/owner-repository publication, package publication, standalone release assets and owner installation changes remain off. Independent Standards and Spec review follows this integration; any resulting fixes and affected rechecks must update this record before final approval/readiness.
