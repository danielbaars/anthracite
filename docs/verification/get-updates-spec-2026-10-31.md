# Get update controls: specification decisions and evidence

Date: **31 October 2026**. Status: specification and existing evidence, not implementation or new runtime acceptance. Read the [complete specification](../specs/get-updates.md).

## Approved delivery

The owner approved one get round: default refresh of eligible locally tracked descendants, downstack-only remote selection, default restack with an opt-out, default target checkout with an opt-out, safe trunk fast-forward and validated PR-base changes. Remote refresh and mandatory local maintenance have separate selections. The existing public CLI/real Git/controlled-gh seam and one existing MCP smoke were approved; targeted Node/native acceptance belongs to later implementation. CI and the full matrix remain off.

Get cleanup/delete-all, remote-only discovery, multiple trunks, broad dirty-worktree support and the sync implementation are excluded. The shared update boundary is designed for later sync reuse without inheriting get's defaults or authorizing a trunk reset. B02 is already released in 0.5.1; [its local acceptance](sync-cleanup-descendants-2026-10-31.md) and [PR #67](https://github.com/danielbaars/anthracite/pull/67) are separate regression context.

## Version bridge

The baseline is [v0.5.1 / `5f76186b`](https://github.com/danielbaars/anthracite/tree/5f76186bcfd2ee0952b9cb48bab1ddf94f00c3c5). The [source bridge](evidence/get-updates-spec-2026-10-31/source-bridge.json) compares ten complete source modules with measured 0.5.0 (`609fb557`): get registration/action, sync action, engine, fetch helper, worktree/frozen protection and continuation persistence/configuration/action. Every compared module is byte-identical. Cleanup is explicitly different because of B02 and is recorded separately. Locked dependency inputs and the CLI dependency declarations are also compared.

This supports carrying forward the source/interface gap classification. It does not relabel a 0.5.0 runtime capture as an execution of 0.5.1, prove every interaction with the repaired cleanup, or make historical counts into current passing tests.

## Retained observations

The [full paired report](https://github.com/danielbaars/anthracite/blob/78937d87424a331de34c2cf3cf95a8944c8d6ff5/docs/verification/get-sync-parity-2026-10-31.md) and its raw captures were committed and pushed before this specification. The [historical index](evidence/get-updates-spec-2026-10-31/historical-evidence-index.json) links 23 relevant observations and their 69 unchanged capture/before/after artifacts at that immutable commit, with SHA-256 hashes. The original ledger has 35 scenario-command observations: 32 normalized and three initial native-unsubmitted controls. Six controlled-gh observations remain separate; none of these numbers is a pass count for this feature.

| Reference | Actual observation | Specification consequence |
| --- | --- | --- |
| G11/G12 | Graphite get base with restack disabled refreshes an existing child; downstack mode retains its earlier head. Anthracite ordinary get retains it. | Default local-descendant refresh and explicit downstack selection, tested independently of replay. |
| G14 | Graphite no-checkout updates child while preserving the starting base checkout/index/files in the clean fixture. Anthracite changes checkout. | Define final-checkout policy, without promising no intermediate checkout or general dirty-state safety. |
| G15 | Graphite default get replays the tip, preserving its unique file and receiving the remote correction. | Add a separately controlled automatic maintenance phase and verify real content. This is not an observed Anthracite get restack. |
| C22 | Graphite advances trunk, updates the target and removes a selected merged ancestor. Ordinary Anthracite get refuses a parent change; a separate forced control updates the feature without advancing trunk or removing old refs. | Add FF-only trunk and guarded same-PR parent changes. Branch removal remains a deliberate unresolved part of C22, outside this delivery. |
| P12 | Both products receive a frozen inbound update and retain frozen status. | Preserve this existing permission; frozen remote refresh is not a missing feature. |
| P11/P13/D11 | Dirt, occupied worktrees and local divergence produce different refusals/skips and partial effects. A nonzero exit is not zero writes. | Preserve user work, distinguish known blockers from late failure, and specify exact success/skip/recovery meaning. Do not copy Graphite's every exit convention. |
| G13 | Remote-upstack did not import absent successors in the GitHub-seeded fixture. | Keep native-submitted/indexed discovery unresolved and remote-only discovery outside scope. It is neither parity evidence nor a proven Graphite defect. |
| S11/D21 | Sync feature-head refresh differs; narrow Graphite deletion consent and Anthracite force/reset authority differ. | Keep a reusable update boundary and separate authority for later sync work. No new sync behavior or cleanup-only flag is implemented here. |

The [supporting index](evidence/get-updates-spec-2026-10-31/supporting-evidence-index.json) retains exact Graphite/Anthracite help references and the independent core/cleanup audits. Current unversioned Graphite web documentation is context in the original report; the measured artifact remains native 1.8.6. New decisions about local-only descendants, preflight, guarded parent changes, graph continuation and checkout restoration are **Anthracite contracts**, not additional measured Graphite claims.

## Implementation touchpoints and existing test seams

Get currently reconstructs a linear PR-base walk and feeds a linear remote-update loop. Its continuation resumes remaining sync branches using the just-completed branch as the next base. Simply appending fanout descendants to that list would attach a sibling to the wrong parent. The new specification therefore requires explicit per-node parent/source identity and separate update/replay phases.

The fetch helper uses shared fetch-head/base refs; a multi-node plan and fresh continuation must retain each pinned source instead of relying on whichever branch was fetched last. Existing checkout protection, owner-checked locking, frozen import decisions, replay operations and guarded continuation remain authoritative. Existing inspection/recovery behavior demonstrates why a saved override cannot replace a physical starting checkout and why a raw Git abort is not a rollback.

Prior tests already execute get fast-forward, frozen inbound/overwrite, import ownership, real terminal reconciliation, ignored-file collisions, hook-sensitive metadata failures and continuation through public processes. Extend those fixtures and existing worktree/replay/MCP seams. No new test framework or private-engine mocks are needed. The old legacy sync fixture's inherited `rebase.updateRefs` issue is documented in the B02 acceptance; isolate test Git configuration rather than interpreting fixture-induced ref movement as a new product regression.

## Contract checks and delivery limits

- Target selection, refresh eligibility, maintenance closure and final checkout are separate and explicit. Downstack limits remote updates; it does not certify that all local descendants can remain untouched after a shared parent changes.
- Feature force, trunk FF-only authority, optional automatic restack and explicit interactive reconciliation are different grants. No combination permits cleanup, trunk reset, unfreezing or GitHub writes.
- Default changes are intentional. Existing callers can select downstack/no-restack explicitly, but safe trunk advancement is still new; the specification does not promise an exact historical execution path.
- New get recovery is optional, owned and backward compatible. Real conflicts, raw abort, cancellation, fresh protection changes and failed final checkout have defined limits rather than a whole-operation rollback promise.
- Closed/merged PR state does not authorize get cleanup. Local-only descendants retain their work; essential service/source failures do not silently become optional skips.

Specification verification checks the required seven sections, numbered stories and decisions, approved scope/exclusions, source equality, evidence hashes, relative links/anchors, English publication and documentation-only changes. It runs no product acceptance scenario, Graphite probe, live GitHub fixture mutation, CI or full matrix. Publishing the specification is not permission to implement it or create implementation tickets.

The [evidence directory](evidence/get-updates-spec-2026-10-31/README.md) explains how to locate each original artifact. Remote references use immutable, already-pushed GitHub commits; no source in a temporary directory is required to read the specification's evidence.
