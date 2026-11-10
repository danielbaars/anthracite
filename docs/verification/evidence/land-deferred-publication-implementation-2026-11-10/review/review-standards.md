# Standards review

Reviewed `a3c9f7055c7a42dfe38daee8fb843f21e1763474...b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76` against `AGENTS.md`, `CONTRIBUTING.md`, the compatibility boundaries in `docs/installation.md`, connected landing code and established public-process test conventions.

**Documented-standard findings: 0.** New source, comments, documentation and commit metadata use English; attribution and licensing are unchanged. Version-1 compatibility is explicitly preserved and exercised with an unchanged released producer. Tests use real disposable Git repositories, bare remotes and the existing external `gh`/MCP boundaries. Node/native and installed-artifact results are qualified by their actual source and campaign boundaries. The user's prohibition on the full matrix overrides the general contributor instruction to run it. No workflow, dependency, release or active-installation change is introduced.

**Baseline smell findings: 0.** The schedule is one small shared query over existing durable state, rather than a parallel mutable queue. The review-blocker extraction prevents duplicating readiness rules. The exported ownership assertion gives the existing private byte guard a meaningful domain boundary. Test-local setup duplication does not justify another abstraction here; the shared real-push observer already contains the reusable transport observation.

Tool-enforced style/type rules were not reported again. This review did not run additional tests or claim full-suite/live-service acceptance. The separately documented pre-existing recovery defects remain outside this change.

**Summary:** 0 documented-standard breaches; 0 actionable heuristic smells. No worst finding.
