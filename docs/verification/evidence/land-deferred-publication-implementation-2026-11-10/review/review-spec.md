# Spec review

Reviewed `a3c9f7055c7a42dfe38daee8fb843f21e1763474...b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76` against `docs/specs/land-deferred-publication.md` and #166–#169.

## Finding

**[P2] Do not claim next-merge readiness after the current target was merged externally** — `apps/cli/src/actions/land_scoped.ts:313–317` (related deferred action labels at 264 and 289).

The specification says, “A later target's old checks do not establish readiness for its pending local head” (line 39), and requires honest fresh next actions (line 42). A version-2 chain paused before #18 can subsequently have #18 merged externally. Fresh inspection correctly changes #18 to cleanup-only, but scheduling labels still use the saved `prepared` phase: #19 remains deferred and its reached-head readiness is not checked. The renderer nevertheless says `READY for next merge only`, although #19 is now the only remaining merge and its local head differs from its published head. It also says “After merging #18” even though the same report confirms that merge is already complete.

Reproduced through the public CLI with real disposable Git/bare remote and controlled gh: `review-spec-cleanup-preview-probe.json` returns status 0, shows cleanup-only #18 plus deferred #19, and records different local/remote #19 OIDs alongside that READY claim. Execution still revalidates; this is misleading approved-plan presentation, not a demonstrated unsafe merge.

Use the freshly confirmed cleanup-only state to describe immediate mandatory publication/maintenance and conditional merge readiness. Cover preserving dry-run/declined resumption for this externally merged case; do not change execution scheduling or recovery bytes merely to render it.

No other missing requirements, incorrect runtime behavior or scope expansion was identified. The known unrelated baseline recovery failures remain outside scope.

Spec findings: **1 P2**.
