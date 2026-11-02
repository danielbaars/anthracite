# Compact resumed landing presentation

Date: 2026-11-02. Unreleased candidate based on the v0.6.3 source, implementation commit `9fc5116d28cc98c975eb20973965d6bb1ab72160`.

The 0.6.3 presentation repair covered fresh plans while leaving pending recovery output verbose. This follow-up uses one compact pending-plan formatter for both `land --dry-run` and actual resumption before confirmation/application. It lists remaining PRs in order, identifies already confirmed merges, distinguishes mandatory maintenance from merge selection, and shows landed-only cleanup and the expected final checkout. A future merge target that first needs maintenance is labelled explicitly; unpublished branches retain their no-push/no-creation boundary.

Preserving previews collect the same fresh checks before rendering blockers above a conditional plan. Phases, original project identity, captured/reached heads, replay boundaries and verified cleanup-result IDs remain available under `--debug`. Application prints captured scope without claiming fresh readiness before execution. No selection, validation, waiting, merge, push, cleanup, continuation or stored-format behavior changes.

## Retained observations

- [0.6.3 source-baseline output](evidence/land-resume-presentation-2026-11-02/source-0.6.3-before.txt) and [initial failing CLI test](evidence/land-resume-presentation-2026-11-02/red.json).
- Candidate [ready preview](evidence/land-resume-presentation-2026-11-02/ready.txt), [blocked preview](evidence/land-resume-presentation-2026-11-02/blocked.txt), [debug stdout](evidence/land-resume-presentation-2026-11-02/debug.txt), [debug diagnostics](evidence/land-resume-presentation-2026-11-02/debug-stderr.txt) and [actual resumption](evidence/land-resume-presentation-2026-11-02/application.txt).
- [Node results](evidence/land-resume-presentation-2026-11-02/node-results.json), [native results](evidence/land-resume-presentation-2026-11-02/native-results.json), [isolated npm results](evidence/land-resume-presentation-2026-11-02/npm-results.json) and [aggregate checksums/results](evidence/land-resume-presentation-2026-11-02/results.json).

Seven selected public-CLI cases pass on Node 24.19.0 and the macOS ARM64 Bun 1.3.14 native build. Four new cases cover ordered compact recovery, debug details with published/unpublished fanout, blocker-first preservation, and completing a real resumption without repeated merges. Three retained controls cover dirty/pending blockers, a deleted original target with reached unpublished work, and a genuine unresolved replay. Two cases pass through an isolated installation of the built npm bundle. Its development version remains 0.6.3; it is not the already published package of that version.

The tests use real temporary Git repositories and bare remotes with controlled GitHub responses. They compare opaque recovery bytes, refs, index and working files before and after inspection. Typecheck, changed-source lint, formatting and whitespace checks pass. No live GitHub PR workflow, application checkout, active installation, CI or full matrix was used. Historical verification retains its original version and scope boundaries.
