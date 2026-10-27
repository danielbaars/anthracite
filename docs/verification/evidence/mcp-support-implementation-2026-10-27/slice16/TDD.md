# MCP execution bounds TDD receipt

Public boundary: the real SDK client over stdio to the built CLI, using actual local Git repositories and hooks. No private handler/timer seam or engine mocks.

- Settings red: missing help options; green: MCP-only integer ranges/defaults, malformed-value rejection and completion.
- Output red: cap returned success; green: exact supported UTF-8 log output above 96KiB, ancestry/final LF, explicit bounded cap and a later command. Fixed fixture commit dates make direct output comparison stable.
- FIFO red: the second repository hook started before the first released; green: independent repositories and linked cwd, discovery/learning responsiveness, ordered IDs and isolated effects.
- Timeout/ownership red: an interrupted ordinary CLI deleted a foreign cache lock; green after the narrow release pid check. The timeout also proves a queued deadline starts after cleanup, ordinary hook/grandchild stopping, owner-only common-dir cleanup, retained staging and unrelated process/Git lock survival.
- Combined output emitted on SIGINT exceeds the cap after timeout; timeout remains the accepted reason while truncation and both captured streams remain bounded.

The initial lifecycle run inside the sandbox could not use ps, so the owned-process tests run outside it. A strict native SIGKILL assertion failed. Corrected PGID observation and snapshots prove the leader is the direct native CLI child of the public server, state Ts after SIGSTOP, with all owned marker PIDs absent after cleanup and the matching cache lock removed. Node reports SIGKILL and Bun reports SIGINT through its ChildProcess API for this forced raw-Git case; the envelope preserves that observed difference. The failed receipts are retained.

Final acceptance: four bounds tests plus 49 affected existing controls pass on each runtime; build, typecheck, uncached source lint and changed-test lint pass. receipt.json binds logs, process/output records and the native SHA-256.
