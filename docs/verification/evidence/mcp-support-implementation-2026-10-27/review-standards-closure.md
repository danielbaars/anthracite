## Standards closure

Reviewed the exact delta `0ccd60b8d55f2b7f138621848b8679cae5c50058...aec33cac28fa9c6623fcb1096c322cdcfc1c0a97` in the clean review-fixes checkout. Only `apps/cli/src/lib/mcp/server.ts` changed (8 additions, 2 deletions).

The previous P3 is closed: the event callback now awaits `shutdown()` inside `try`/`catch`, writes an stderr diagnostic and deliberately exits with failure if shutdown rejects. The existing `finally` still awaits owned-work draining before that failure reaches the callback. This satisfies the NVWA TypeScript rejection-handling rule without changing ordinary lifecycle sequencing.

No new actionable standards or baseline-smell findings. No tests were run for this closure review; the reported Node/native lifecycle, build, check and lint results were supplied by the implementing agent. No private fault-injection seam is required for this small error-boundary correction.

Remaining findings: 0.
