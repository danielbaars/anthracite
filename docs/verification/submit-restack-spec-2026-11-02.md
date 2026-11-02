# Submit restack specification record — 2 November 2026

## Status and approved boundary

The [specification](../specs/submit-restack.md) defines opt-in restacking during submission against released npm Anthracite 0.6.0, main `eb23e4f8e924da24e00ae06484799687adde66b1`. The user approved the scope and testing boundary before this document was written. This delivery adds specification, supporting documentation and one GitHub issue, not implementation or new runtime acceptance.

The approved behavior is selection before effects, bounded local repair followed by existing submission, a non-rewriting preview, retained frozen/worktree/local-work protection and local-only conflict continuation. CI and the full matrix remain off. No live PR mutation, package installation/publication, implementation PR or implementation tickets are included.

## Evidence reused, not rerun

The [1 November comparison](https://github.com/danielbaars/anthracite/blob/33768b3de6be9f9be9d42b5367b07440a5affeb3/docs/research/submit-comparison-2026-11-01.md) retains seven paired Graphite 1.8.6 / npm Anthracite 0.6.0 scenarios and five separate Anthracite component controls. Its [observations](https://github.com/danielbaars/anthracite/blob/33768b3de6be9f9be9d42b5367b07440a5affeb3/docs/verification/evidence/submit-comparison-2026-11-01/observations.json), [REA captures](https://github.com/danielbaars/anthracite/blob/33768b3de6be9f9be9d42b5367b07440a5affeb3/docs/verification/evidence/submit-comparison-2026-11-01/rea-captures.json), [identities](https://github.com/danielbaars/anthracite/blob/33768b3de6be9f9be9d42b5367b07440a5affeb3/docs/verification/evidence/submit-comparison-2026-11-01/identities.json) and [source/options note](https://github.com/danielbaars/anthracite/blob/33768b3de6be9f9be9d42b5367b07440a5affeb3/docs/verification/evidence/submit-comparison-2026-11-01/source-options.md) keep their original authority and limitations.

| Retained observation | Consequence for this specification |
| --- | --- |
| Both default stale-chain previews refuse. Anthracite lacks the restack option. | Add opt-in integration; retain the ordinary default and false/negative controls. |
| Graphite explicit restack repairs the chain; stack selection adds the fanout arm. Separate Anthracite component controls obtain matching branch trees. | Reuse the existing local engine with an explicitly selected repair scope; do not invoke broad sync/restack implicitly. |
| Graphite restack-enabled dry-run rewrites heads. | Deliberately diverge: preview reports planned repair without executing it. |
| Graphite conflict probe fails without a live rebase; separate Anthracite restack retains a real conflict. | Retain Anthracite's honest conflict state and define local-only continuation before publication. |
| Graphite occupied-branch preview succeeds while leaving stale history. Anthracite's component restack refuses. | Preserve actual participant protection rather than copying a misleading success outcome. |
| Metadata/review observations are help/source findings, not live execution. | Exclude new modes and the existing-PR editing concern from this implementation contract. |

These are reused historical results, not newly passing tests. The comparison did not test successful real GitHub publication after repair. Its controlled Anthracite GitHub adapter, Graphite discovery, preview-only service boundary, failed setup attempts and process-observation limitations remain applicable.

## Baseline inspection and explicit design decisions

Current main remains the 0.6.0 release commit. Inspection confirms separate submit selection/validation/preparation/publication, default scoped restack support, preservation controls for Git update-refs, existing frozen/worktree guards and multiple owned continuation routes. Existing generic continuation is not proof that the new submit-owned local queue already meets this specification. In particular, safely retaining stale/foreign submit intent may require optional bounded context rather than inheriting generic state-clearing behavior.

The following are approved Anthracite design decisions, not claims measured from Graphite:

- Repair is opt-in and constrained to effective eligible selection. Update-only excludes absent PRs and cannot gain create authority from always; an excluded parent must remain a valid remote anchor.
- Initially unchanged eligible PR branches stay candidates until post-replay status is known. Existing applicable ancestor footer maintenance is disclosed separately from pushed heads.
- A safe dry-run preserves local history/work/recovery while allowing ordinary read-only discovery and administrative PR-cache refresh. It need not simulate arbitrary conflicts.
- Confirmation precedes repair, all chosen local repair and original attached-checkout restoration precede remote mutation, and a new remote race stops rather than widening scope or overwrite authority.
- Continue is a bounded local operation. It stores no deferred publication job; fresh explicit submit is required after recovery. Completed local/remote effects are reported rather than rolled back.

The specification's implementation decisions use module responsibilities and behavioral contracts, not fixed production file paths or private testing interfaces. Existing submit CLI/preview/role/interaction and restack-continuation fixtures provide the primary public seam. Exactly one MCP smoke can also provide the installed bundle's new feature check. Node/native checks remain focused; no complete matrix is introduced.

## Documentation-only validation and publication

The [validation receipt](evidence/submit-restack-spec-2026-11-02/validation.json) records the spec template, numbered sections, local links, reviewed baseline identity and historical evidence hashes. These are documentation checks, not feature test results. No new Graphite or Anthracite runtime probes were performed for this specification.

The specification is committed and pushed with its supporting record and discoverability links before issue publication. The GitHub issue carries the same contract, uses `ready-for-agent`, and links the immutable pushed documents. The documentation branch is outside every automatic push trigger; no PR or workflow dispatch is created. Verify that the issue body/label and remote document match, and that the branch has zero Actions runs.

G07 remains open implementation work. U01 keeps untested live-publication and broader service combinations separate. Deferred log issue #12 and its priority are unchanged. This document neither certifies complete Graphite parity nor authorizes implementation or CI by itself.
