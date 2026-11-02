# Preserve local sync survivors after their parent merges

Date: 2 November 2026. Baseline: released Anthracite 0.6.0, main `eb23e4f8e924da24e00ae06484799687adde66b1`. This records the focused repair and its pre-release checks, not a version publication or a new Graphite comparison.

## Reproduction and cause

A real-Git fixture tracks `main → parent → child`. Child has one unpublished local correction. The remote parent PR is squash-merged into main, its branch is removed and the open child PR is retargeted to main while its remote head stays unchanged.

The initial regression on the unmodified baseline failed before cleanup with the same different-parents/overwrite classification. Noninteractive sync refused; the earlier separate terminal reproduction showed that accepting overwrite removes the local correction from the reached child history. All reproductions use synthetic temporary repositories and controlled GitHub responses, not application-project mutations.

The remote-refresh preflight treated the expected parent transition as an unrelated parent replacement because the local head was ahead rather than identical to or behind the fetched source. Replacing the head would discard the unpublished correction before cleanup could preserve and replay it.

## Bounded repair

Sync recognizes only a freshly verified merged old parent targeting the same configured trunk, with that PR head matching the old local parent and the fetched child head strictly ancestral to its local head. It validates the existing snapshot, releases the unused incoming-source pin and retains the child's local head and original replay boundary for existing cleanup/maintenance planning. Fresh PR information is still processed. No persisted schema, get contract, general parent-reconciliation policy or publication authority changes.

Cleanup remains separately authorized. No-delete retains the parent; no-restack retains the child head while reporting pending repair. Actual divergence and a closed/unmerged parent still refuse unattended replacement. Other incoming descendant updates continue through their existing snapshots and are maintained above the preserved local correction.

## Focused local validation

The new [public-CLI regressions](../../apps/cli/test/commands/sync_merged_parent_local_cli.test.ts) exercise real Git repositories and a bare remote with the existing controlled external GitHub boundary:

- Cleanup/restack retains the correction's file content, original author, complete commit message and final tree, restores the child checkout and performs no remote writes.
- No-delete/no-restack keeps the exact local head and parent.
- Authorized cleanup with no-restack reparents without rewriting or losing the correction.
- A published descendant receives its new remote change and the preserved local correction, with valid ancestry and clean checkout.
- Remote divergence and a closed parent retain explicit reconciliation/refusal without local head replacement.

All six new scenarios and eight selected existing refresh, survivor, authority and continuation controls pass on both Node 24.19.0 and the locally compiled Bun 1.3.14 native CLI. These are 14 distinct selected scenarios per runtime, not a full suite. Initial test-only failures were corrected: the divergence fixture needed its producer switched back to child; the extended three-branch incoming case exceeded the fixture's 15-second command budget under concurrent checks and passed with a bounded 45-second budget. Only the affected cases were rerun; the [result index](evidence/sync-merged-parent-local-commits-2026-11-02/results.json) uses the latest passing observation for each scenario and retains the superseded setup/timeout failures separately.

Typecheck, changed-source lint, formatting and diff checks pass. The exact temporary npm tarball passes offline installation, both commands/completion/content checks, all nine existing package scenarios, and the new merged-parent regression. Its initial sandboxed package run could not observe the numeric-zero cancellation hook; the same tarball passed the complete gate with local process observation outside the sandbox. No unrelated MCP or test-tooling production change was made.

CI and the full matrix remain off. No live GitHub writes, active installation changes or application-project commands are part of the repair. The candidate retains 0.6.0 package metadata for local testing and must not be confused with the published 0.6.0 artifact. Published 0.6.0 does not contain this repair.
