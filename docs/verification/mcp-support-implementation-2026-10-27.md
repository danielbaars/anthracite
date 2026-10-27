# MCP implementation acceptance — 27 October 2026

The implementation of #13 and #14–#18 passes all fifteen approved public scenarios on macOS ARM64, using a real MCP client over stdio to both the Node CLI and a separately compiled native executable. This is implementation acceptance for the bounded [specification](../specs/mcp-support.md), not certification of every agent application or complete Graphite parity. See [client configuration and behavior](../mcp.md).

## Candidate and checks

- Tested source: `aec33cac28fa9c6623fcb1096c322cdcfc1c0a97`; CLI source tree `3504cadba8611243843e467fc486ed0601030871`.
- Node `24.19.0`; Bun compiler `1.3.14`; TypeScript `5.5.4`; official MCP SDK `1.32.2` with the committed numeric-request-ID-zero cancellation patch.
- Native SHA-256: `6eaf5311ce9e82d7bd43e9e627bb64ffa45c9c44363ba9ecc8f29b92dcb29bcb` (66,121,058 bytes). This temporary verification binary was not installed or released.
- Final forced build: two tasks successful, zero cached. Typecheck and uncached complete source/changed-test lint passed.
- Final integrated selection: **31 passing, zero failures, zero pending on each runtime**, across seven files. This comprises 22 MCP cases plus two identity and seven completion controls.
- Earlier ticket-level affected direct-CLI selections passed on both runtimes (39 for execution/parser/editor work and 49 for bounds work). They are separate slice evidence, not additional tests counted in the final 31.

The [acceptance record](evidence/mcp-support-implementation-2026-10-27/acceptance.json) binds source/binary identities and results. Final [Node](evidence/mcp-support-implementation-2026-10-27/final/node/summary.json) and [native](evidence/mcp-support-implementation-2026-10-27/final/native/summary.json) summaries retain every selected file and count. Their `captures/` directories contain unchanged representative wire, workflow and owned-process observations from this final source.

## Approved scenario coverage

All rows passed on both runtimes. Tests use the public stdio process boundary; setup and independent observations use real temporary Git repositories.

| Scenarios | Public test file | Observed outcome |
| --- | --- | --- |
| 1–2 | `mcp_cli.test.ts` | Outside-Git/no-auth startup, both protocol versions, static discovery, both executable spellings, help/completion and maintained learning; no automatic repository or authentication work. |
| 3–4 | `mcp_execution_cli.test.ts` | Direct inspection equivalence, same-build launch despite PATH sentinels, real staged create with literal Unicode/shell-looking arguments. |
| 5 | `mcp_workflows_cli.test.ts` | Modify and substantive restack agree with independent direct controls; another stack remains intact. |
| 6 | `mcp_bounds_cli.test.ts` | FIFO across two repositories and a linked worktree, associated IDs/results, authoritative cwd and early refusals. |
| 7–8 | `mcp_execution_cli.test.ts` | Input/protocol/CLI failures remain distinct; later requests work; no Anthracite prompts/editor/pager, recursion or framing pollution. |
| 9 | `mcp_workflows_cli.test.ts` | Frozen and occupied-worktree refusals preserve refs, tracking, indexes and dirty linked files. |
| 10 | `mcp_workflows_cli.test.ts` | Genuine two-conflict recovery preserves partial state across idle close, resolution and fresh-session continue; direct control agrees. |
| 11 | `mcp_workflows_cli.test.ts` | Explicit selected-stack submit performs local bare pushes with the existing controlled gh adapter; bases/drafts/approved metadata/hooks agree and unrelated work remains intact. No live PR. |
| 12–13 | `mcp_bounds_cli.test.ts` | Complete 96KiB UTF-8 output/final LF; explicit combined output cap; timeout and forced-stop descendant cleanup, owner-only lock cleanup, foreign controls preserved and later request succeeds. |
| 14–15 | `mcp_lifecycle_cli.test.ts` | Active/queued cancellation including ID zero, omitted cancelled responses, harmless malformed/late/unknown notifications; EOF/SIGINT/SIGTERM/EPIPE stop owned work, discard queue, preserve recovery/staging/foreign work and permit fresh inspection. EOF uses owned pipes without SDK fallback termination. |

## Review and compatibility evidence

The independent [spec review](evidence/mcp-support-implementation-2026-10-27/review-spec.md) found no actionable mismatch. The [standards review](evidence/mcp-support-implementation-2026-10-27/review-standards.md) found one unhandled shutdown-promise rejection; the sole review-fix commit added explicit stderr/failure handling, and [closure review](evidence/mcp-support-implementation-2026-10-27/review-standards-closure.md) confirms zero remaining findings. Public lifecycle cases pass after the fix. No private fault-injection seam or synthetic red claim was added for the hypothetical SDK rejection.

The original compiler gate failed against SDK-reachable Zod declarations under TypeScript 4.7. The bounded adjustment pins TypeScript 5.5.4 and compatible Node declarations, retaining CommonJS/Mocha; an equivalent Retype literal schema retains the existing branch-replacement union. Six direct controls cover the three replacement values across both runtimes. The official SDK's zero-ID cancellation guard was separately reproduced and patched in its CJS/ESM distributions. Retained `slice14`–`slice18` and `review-fix` records distinguish original failures from passing outcomes. Slice receipts are copied unchanged and can reference additional host-local logs; the manifest certifies the retained subset, not omitted binaries or all temporary fixture files.

## Practical limits and delivery

In the forced-stop fixture, Node reports `SIGKILL` and Bun's ChildProcess reports `SIGINT`. The result preserves the runtime observation. Independent PID/PPID/PGID and stopped-state records prove the owned leader/hook/grandchild disappear, the owned cache lock is removed and foreign control/lock state survives. Do not interpret the native signal field alone as a complete history of signals sent.

Linux-specific zombie inspection is implemented but was not exercised on this macOS host. Windows and deliberately detached third-party daemons remain outside scope. Interruption does not roll back Git changes or delete Git lock/recovery state; inspect reached state before continuing.

No Actions run, full matrix, release asset, tag, live GitHub fixture PR, global installation or client registration was started for these local checks. #12 remains deferred. Issue closure belongs to the single implementation PR's merge; this report does not close issues by itself.

Verify the retained files with `python3 docs/verification/evidence/mcp-support-implementation-2026-10-27/check_evidence.py`. Documentation-only commits after the tested source must preserve the recorded CLI source tree and runtime/build inputs.
