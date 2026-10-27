# Ticket #14 implementation receipt

Commit: `95b1c619d0bc904ebae606554100d404ec3bf4ba` on `mcp-server-learning`.
Verified clean starting HEAD and final rebase target: `6cca18907f8a0d208d8ef8c8208010c1ce376243` (`mcp-support-spec`). Worktree is clean after commit/rebase.

## Delivered

- Explicit `mcp` registration, bundled name/version, static discovery and strict empty-input `learn_an`, using official SDK 1.32.2 over stdio. No executor stub.
- Original English workflow guidance covering staging, inspection, create/modify/restack, frozen/worktree guards, recovery, cwd authority and deliberate publication.
- Persistent actual SDK `Client`/`StdioClientTransport` helper (`test/lib/mcp_client.ts`): public `client`, `transport`, `messages`, `errors`, `stderr`, `connect(protocolVersion?)`, `close()`. Its optional third constructor argument is the launch tuple; defaults to the existing Node/native launcher. It varies the outgoing SDK initialization version for representative compatibility probes; it does not implement protocol framing.
- Protocol stdout is parsed by the SDK. Hostile git/gh/editor/pager sentinels prove startup/help/learning avoid external tools. Isolated HOME/config directories remain unchanged.

## Compatibility gate

The actual initial no-emit check under the previous TypeScript 4.7 compiler fails on SDK-reachable Zod 4 `const` type parameters; representative errors are retained in `compiler-initial.log` (202 lines). TS 5.5.4 is pinned for the root and CLI. Node 22.10.2 declarations replace Node 17 declarations whose AbortSignal conflicts with TS5.5 DOM declarations. Runtime stays Node24.19.0/Bun1.3.14, CommonJS and Mocha.

One equivalent `t.literals(['_', '-', ''] as const)` expression preserves the existing branch-replacement union under the newer compiler. Six public CLI controls (all three replacement values on Node/native) passed in `branch-replacement-controls.log`. No stored format changed. Direct Zod4.6.7 is pinned to share the SDK dependency rather than retain a second Zod3 copy.

The lower-level official SDK Server is intentional: high-level McpServer unconditionally advertises tools.listChanged=true. All framing, request schemas, initialization and errors still use the official SDK.

## Validation

- TDD startup red: `startup-red.log` (connection closes before MCP registration); first green Node/native retained.
- TDD learning red: `learning-red.log` (missing concrete explicit-cwd request example), subsequent green retained.
- `turbo run build`, CLI `check` (no emit), uncached complete source lint, uncached changed-test lint, and `git diff --check`: passed.
- Final Node: **16 passing** (48s); final native: **16 passing** (39s). Each includes seven focused MCP checks for parent scenarios1–2, two release-identity controls and seven existing completion controls. No skips.
- Required 2024-11-05 and 2025-11-25 handshakes pass. Unsupported version follows SDK negotiation by selecting2025-11-25; unknown methods/tools return protocol errors and the same session remains usable.
- Both installed command spellings, root/server help, version and completion pass. Node spelling probes use a fixture wrapper around the same fixed built entry; native spelling probes use symlinks to the compiled executable. This is not a global installation.
- Native build: Bun1.3.14,589modules; binary SHA-256 `860ed42a5132744ae691047f5f1c734bfb2bb261815bf5d3a1382ca547d69c1c`.
- `node/` and `native/` retain SDK protocol receipts and controlled fixture evidence. `manifest.json` hashes the top-level receipts and compiled binary.

## Boundaries

Execution, scheduling, limits and active-child lifecycle belong to #15–#17; combined recovery/submit acceptance belongs to #18. This intermediate slice intentionally lists only the working learning tool. No full matrix, push, PR publication, release, global install, client registration or live GitHub PR ran. Initial dependency installation required network access, only in this private worktree. An intermediate validation started during dependency relinking failed to import Zod; it was rerun only after installation and a fresh build completed. Final receipts above are from the settled tree.
