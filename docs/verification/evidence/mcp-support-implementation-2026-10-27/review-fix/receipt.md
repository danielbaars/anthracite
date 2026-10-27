# MCP shutdown review fix

Commit: `aec33cac28fa9c6623fcb1096c322cdcfc1c0a97` on temporary untracked branch `mcp-review-fixes`, based on the current integration tip `0ccd60b8d55f2b7f138621848b8679cae5c50058`. The worktree was clean at that exact base before editing and clean after committing and checking the rebase. No merge commits were introduced.

The sole actionable final-review finding was an unhandled asynchronous rejection at the shutdown event boundary. `stop` now awaits shutdown inside a catch boundary, reports failure on stderr and deliberately exits 1. The existing synchronous admission stop, SDK close and owned-work drain remain unchanged. Shutdown failure cannot resume this server or advance queued mutations, and the diagnostic makes no rollback claim. The production diff touches only `apps/cli/src/lib/mcp/server.ts` (8 added, 2 removed lines).

## Verification

- Forced workspace build: passed (`02-build.log`). The first implementation exceeded the existing function-length rule; its compact diagnostic passes without a lint exemption or new abstraction (`01-build.log`).
- Typecheck: passed (`03-typecheck.log`).
- Uncached full source lint: passed (`04-source-lint.log`).
- Uncached existing lifecycle test/client fixture lint: passed (`05-lifecycle-lint.log`). No tests or fixtures changed.
- Node 24.19.0: 3 lifecycle cases passed (`07-node-lifecycle.log`).
- Bun 1.3.14 independently compiled native executable: the same 3 lifecycle cases passed (`06-native-build.log`, `08-native-lifecycle.log`).
- The existing public cases cover active and queued cancellation, numeric-zero cancellation, malformed/unknown/completed notifications, EOF, SIGINT, SIGTERM and EPIPE; they independently observe owned descendants and direct-child reap, discard queued mutations, preserve unrelated processes/foreign locks and retain genuine conflict recovery for a fresh connection.
- `git diff --check HEAD^ HEAD` passed; final worktree clean; rebase onto `mcp-support-spec` confirmed up to date.

## Test boundary and limits

The pre-approved seam remains the real MCP client over stdio to the public CLI with local Git/process fixtures. No new test framework, private fault-injection seam or implementation-mirroring assertion was added. The pinned SDK's ordinary stdio `close()` path resolves, and executor shutdown drains its existing worker; no public input establishes a close/drain rejection. Therefore this defensive standards fix has no synthetic runtime red/green claim. The existing behavioral lifecycle suite provides focused regression evidence; the caught hypothetical rejection is established by inspection.

All tests ran on macOS ARM64, including authorized host `ps` observations. This does not establish Linux-specific zombie behavior or all-platform certification. No broad 49-case direct-control repeat, full matrix, push, PR, CI, release, global installation, client configuration or live GitHub operation was performed. The coordinator will run the final integration union.

## Identities

- Source server SHA-256: `1220e9ae55b9e3f6eef24d736a4f5df4fcb66e725f0a91b2c18ad39a0c13c3f8`.
- Built Node server SHA-256: `74b3cf153af4241c5422f1db01495d2fa19cc76c000743ca701af8a74fb236d6`.
- Built Node entry SHA-256: `f41af96e346bcfc1648d5636bc8feb109e70d0df7e5fd91e9a4ebf2b07c010bd`.
- Native executable SHA-256: `e62ff168718511e8e702c0d2a5cfa628cb5a819610bb9716bd8585afaa35be09`.

`manifest.json` binds logs and all retained public fixture evidence by SHA-256. The native executable is retained beside this receipt. Generated Turbo files were not committed.
