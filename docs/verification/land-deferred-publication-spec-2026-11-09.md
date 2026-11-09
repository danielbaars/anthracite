# Deferred landing publication: specification record

On 9 November 2026 the maintainer approved the scope and public-process test boundary for the [compact specification](../specs/land-deferred-publication.md).

The approved change delays remote publication and matching PR reconciliation for later merge targets only. Local replay, eager non-target survivor maintenance, local-only status and cleanup scope remain unchanged. New operations use an explicit deferred schedule; previously saved landings retain their eager schedule. Plans/recovery disclose deferred work. No new CLI option or repository-workflow adjustment is included.

The approved seam is public CLI processes with real temporary Git repositories/bare remotes and controlled gh answers, with independent pre-push/post-receive counting. The controlled seven-PR target is six feature updates plus seven deletions, compared with the measured 21 plus seven. Acceptance includes fanout, required/optional checks, interruption/resumption, conflicts/local continuation, leases/concurrent changes, PR content/roles and real old recovery files; focused Node/native and installed npm checks plus one existing MCP smoke.

The [measured baseline](land-push-amplification-2026-11-09.md) and [source analysis](land-push-deferral-source-analysis-2026-11-09.md) remain historical evidence. This document/specification adds no new runtime measurement or claim that the proposed optimization works. The specification chooses version 2 for new landing records, keeps version-1 eager scheduling and requires preparing the next PR's base before its landed parent is deleted.

Specification checks cover required sections, story coverage, local links, retained evidence hashes and documentation-only changes. No production code, live test PR, user project, active installation, CI/full matrix or release is changed or run. After pushing the canonical files, publish the complete English specification to the Anthracite tracker with `ready-for-agent` and immutable document links. Do not create implementation tickets or a PR in this step.
