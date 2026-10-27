## Standards

Reviewed the exact three-dot diff `e201e0629c547f3c88845ab37a9bf64555f21c19...0ccd60b8d55f2b7f138621848b8679cae5c50058` and its seven commits against AGENTS.md, CONTRIBUTING.md, COMPATIBILITY.md, docs/installation.md and the NVWA TypeScript skill.

**Documented-standard breach — P3:** `apps/cli/src/lib/mcp/server.ts:100–111` starts shutdown from event callbacks with `void shutdown();`, but neither this call nor `shutdown()` handles a rejection from the awaited close/drain operations. This violates the NVWA TypeScript skill's Async rule, “Always handle rejections.” `finally` guarantees cleanup sequencing but does not handle a rejected promise. Handle the failure once at this event boundary, with an stderr diagnostic and a deliberate failure policy after owned-work cleanup. This is a standards finding; no failure in the pinned SDK's ordinary close path was established.

**Baseline smells:** No actionable findings. The public-process test helpers, explicit command registration and separately owned cleanup probe have concrete purposes. Shared test shapes differ in their assertions, and extracting them further would add coupling without a demonstrated maintenance benefit.

English publication, inherited attribution and stored metadata/continuation boundaries are preserved. Existing Mocha/process-fixture conventions, relative imports, CommonJS, the relocated command-module cast and the documented SDK/declaration pins and cancellation patch were treated as repository-specific decisions. Tooling-enforced items and implementation-spec acceptance were excluded.

Total: 1 documented-standard finding (P3); 0 actionable smell findings.
