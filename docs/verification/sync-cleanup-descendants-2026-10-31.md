# B02: cleanup below retained branches

Date: 31 October 2026. Source baseline: `609fb557d4b6a429d91f500169c596592139d9d1` (0.5.0). Status: repaired in this candidate; not released.

The [paired live investigation, case C23](https://github.com/danielbaars/anthracite/blob/78937d87424a331de34c2cf3cf95a8944c8d6ff5/docs/verification/get-sync-parity-2026-10-31.md) showed a known CLOSED tip surviving below an OPEN parent. Cleanup only searched children after accepting their parent for deletion.

Cleanup now searches every tracked descendant. A candidate belongs to one selected ancestor's cleanup group even when retained branches separate them, preventing duplicate deletion and preserving the existing joint survivor/frozen checks. Eligibility, confirmation, worktree protection and optional replay rules remain authoritative.

Three public-CLI regressions use real local Git with controlled GitHub responses:

- Remove a known closed leaf under an open parent, preserving that parent's head/metadata and remote refs. Noninteractive confirmation and `--no-delete` still retain the leaf.
- Remove closed branches separated by an open survivor exactly once and reparent live descendants without replay under `--no-restack`.
- Repeat the separated case with a frozen deletion candidate and editable survivors.

All three fail against the published npm 0.5.0 bundle and pass against the candidate on Node 24.19.0 and macOS ARM64 native, compiled with Bun 1.3.14. The [result receipt](evidence/sync-cleanup-descendants-2026-10-31/results.json) records source/artifact hashes, case names and counts.

Local validation covers **53 distinct cases per runtime**: three new regressions, 32 existing frozen-sync/protection cases, four sync-continuation cases and 14 legacy sync cases. Typecheck, source lint, changed-test lint and whitespace checks pass.

The initial legacy sync run had four failures per runtime, also reproduced in the unmodified public 0.5.0 bundle. Its fake squash helper inherits the host's `rebase.updateRefs=true`, moving fixture branches outside metadata updates. Repeating that file with the process-only override `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=rebase.updateRefs GIT_CONFIG_VALUE_0=false` passes all 14 cases per runtime. These replace the initial legacy results; they are not counted twice. User Git configuration and the inherited fixture helper were not changed.

No live GitHub changes, CI, full validation matrix, release or installation update was performed. This bounded repair does not implement additional get/sync modes or claim full parity.
