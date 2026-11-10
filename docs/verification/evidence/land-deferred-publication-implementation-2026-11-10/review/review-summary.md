# Final deferred landing code review

Reviewed baseline `a3c9f705` through `b8e4188b`, then independently rechecked the presentation-only correction through `267302bf`. Runtime source after correction: `6783ac2e`.

## Standards

Reviewed `a3c9f7055c7a42dfe38daee8fb843f21e1763474...b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76` against `AGENTS.md`, `CONTRIBUTING.md`, the compatibility boundaries in `docs/installation.md`, connected landing code and established public-process test conventions.

**Documented-standard findings: 0.** New source, comments, documentation and commit metadata use English; attribution and licensing are unchanged. Version-1 compatibility is explicitly preserved and exercised with an unchanged released producer. Tests use real disposable Git repositories, bare remotes and the existing external `gh`/MCP boundaries. Node/native and installed-artifact results are qualified by their actual source and campaign boundaries. The user's prohibition on the full matrix overrides the general contributor instruction to run it. No workflow, dependency, release or active-installation change is introduced.

**Baseline smell findings: 0.** The schedule is one small shared query over existing durable state, rather than a parallel mutable queue. The review-blocker extraction prevents duplicating readiness rules. The exported ownership assertion gives the existing private byte guard a meaningful domain boundary. Test-local setup duplication does not justify another abstraction here; the shared real-push observer already contains the reusable transport observation.

Tool-enforced style/type rules were not reported again. This review did not run additional tests or claim full-suite/live-service acceptance. The separately documented pre-existing recovery defects remain outside this change.

**Summary:** 0 documented-standard breaches; 0 actionable heuristic smells. No worst finding.

Reviewed the correction `b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76...267302bfc63d4a4e05ca08f9cdcf7d8edc8e7c39`, including source commit `6783ac2e0f94ddd1351b9599aa8c71b653c7f9cc`. The original Standards report remains unchanged.

**New documented-standard findings: 0. New actionable smell findings: 0.**

The delta is confined to pending-plan formatting and public-process assertions. It introduces no mutation of the saved recovery version/phase, scheduling decision, publication authority or execution guard. The shared inspection type and small formatting helpers keep the fresh due/deferred and cleanup-only labels consistent between ordinary and debug presentation; their domain purpose justifies the extraction. No speculative abstraction or unrelated refactor was added.

English source/comments and established real-Git/controlled-gh tests conform to the repository rules. The new preserving inspection case and the strengthened existing resumption case cover the changed user-visible contract. Existing suite-length lint is explicitly identified as inherited rather than suppressed or misreported as new acceptance. Source/type/style and bounded Node/native/installed-package receipts are reported with their actual source boundaries.

No additional tests, CI, remote operations or code changes were performed for this read-only confirmation. The full-matrix prohibition remains respected.

**Summary:** Standards remains clear: 0 documented breaches and 0 actionable heuristic smells.

## Spec

Reviewed `a3c9f7055c7a42dfe38daee8fb843f21e1763474...b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76` against `docs/specs/land-deferred-publication.md` and #166–#169.

### Finding

**[P2] Do not claim next-merge readiness after the current target was merged externally** — `apps/cli/src/actions/land_scoped.ts:313–317` (related deferred action labels at 264 and 289).

The specification says, “A later target's old checks do not establish readiness for its pending local head” (line 39), and requires honest fresh next actions (line 42). A version-2 chain paused before #18 can subsequently have #18 merged externally. Fresh inspection correctly changes #18 to cleanup-only, but scheduling labels still use the saved `prepared` phase: #19 remains deferred and its reached-head readiness is not checked. The renderer nevertheless says `READY for next merge only`, although #19 is now the only remaining merge and its local head differs from its published head. It also says “After merging #18” even though the same report confirms that merge is already complete.

Reproduced through the public CLI with real disposable Git/bare remote and controlled gh: `review-spec-cleanup-preview-probe.json` returns status 0, shows cleanup-only #18 plus deferred #19, and records different local/remote #19 OIDs alongside that READY claim. Execution still revalidates; this is misleading approved-plan presentation, not a demonstrated unsafe merge.

Use the freshly confirmed cleanup-only state to describe immediate mandatory publication/maintenance and conditional merge readiness. Cover preserving dry-run/declined resumption for this externally merged case; do not change execution scheduling or recovery bytes merely to render it.

No other missing requirements, incorrect runtime behavior or scope expansion was identified. The known unrelated baseline recovery failures remain outside scope.

Spec findings: **1 P2**.

Reviewed integration `267302bfc63d4a4e05ca08f9cdcf7d8edc8e7c39`, specifically `b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76...267302bfc63d4a4e05ca08f9cdcf7d8edc8e7c39`, against the original Spec P2 and the approved deferred-publication contract.

**The original P2 is resolved.** Fresh confirmation that the saved current target has merged now derives the immediately due unmerged target for presentation. Default and debug output use the same due/deferred interpretation. The plan says `After confirmed merge`, discloses the next target's immediate push/base/footer maintenance, and reports `PENDING` instead of claiming that unpublished target is ready to merge.

The correction remains in formatting and consumes the existing fresh cleanup-only evidence. It neither rewrites recovery bytes nor changes the durable phase, execution scheduler, publication authority, inspection decisions or merge guards. Ordinary deferred plans retain their prior presentation.

Reviewed the added public regression, strengthened existing resumed-plan assertion, and retained red/green/native/installed receipts. These exercise preserving dry-run/declined-confirmation equality and unchanged explicit completion; the rebuilt npm candidate also exercises real MCP delivery. No broad campaign was repeated during this recheck.

No new substantive specification issue or scope expansion was identified.

Open Spec findings: **0**.

Summary: Standards 0 findings; Spec 1 resolved P2, 0 open findings. No unresolved worst finding on either axis.
