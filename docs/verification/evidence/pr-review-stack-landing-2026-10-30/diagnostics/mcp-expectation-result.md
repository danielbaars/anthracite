# MCP expectation correction

Test-only commit `901561275fac5ee356e8651f0f2a7f536ce2ccf7`, tree `cc7786f52af0df1bf6c732e74cbf9fe6b6c7aece`, changes only `apps/cli/test/commands/land_mcp_cli.test.ts` and carries `[skip ci]`.

The genuine unresolved-replay preview now expects the normal MCP `cli_error`, exit1 and `isError` envelope, with its exact blocker. Independent raw index/refs/recovery snapshots, remote refs and PR-state equality are checked around that failed preview. Existing subsequent local-only continuation, PR/review ledger and final landing assertions remain intact.

The public real stdio MCP case passes1/1 on Node and1/1 on the existing native executable. Strict compilation and test lint/format pass. Every appsrc and compiled production byte hash is unchanged from `cbd4b7964a2fdcb05fcdab6f2c4e9ac3f13b70de`; native SHA256 remains `99ac73716134530891a32739a6cf65fbdcff405106efdefb1123db396b345a2b`. No production changes or artifact rebuild were needed. The original installed failure is preserved separately.

See `review-fixes-mcp-expectation-receipt.json` and `review-fixes-mcp-expectation-source.json` for exact source/report/artifact hashes. Parent cohort completion and any other test corrections are awaited before final handoff. No integration/dist, installed prefix, shared dependencies, push, PR, CI, live service or installation was changed.
