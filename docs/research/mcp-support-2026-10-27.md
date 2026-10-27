# Local MCP support: evidence and design basis

Date: 27 October 2026. Anthracite source baseline: `e201e0629c547f3c88845ab37a9bf64555f21c19`; installed binary: `0.1.1-dev.20261027173714`. This is a specification investigation, not implementation acceptance.

## Findings

| Question                                                      | Observation                                                                                                                                                                                                                     | Authority / boundary                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does Anthracite already serve MCP?                            | No registered MCP module or dependency was found in the inspected source. The installed `an mcp --no-interactive` exits 1 with `Unknown argument: mcp`.                                                                         | Direct source audit and actual installed CLI. A preliminary help-only query returned root help and exit 0; it was not a valid absence test.                      |
| What is Graphite's interface?                                 | Graphite 1.8.6 initializes a stdio server and lists `run_gt_cmd` and `learn_gt`. The execution input requires `args`, `cwd` and `why`; learning takes an empty argument object.                                                 | Shipped CLI discovery plus a real stdio client. This is not a claim about newer Graphite versions.                                                               |
| What does learning return?                                    | One text content item, 35,304 UTF-8 bytes, with SHA-256 `09892efe639b54b1a7bf8c6e5f6a0a107c80ef4c52c4f279af47fe0f5a7870b1`.                                                                                                     | Returned document fingerprint. The proprietary guide is not reproduced. Its contents are target material, not instructions adopted by the investigator.          |
| Does execution work?                                          | A version call returns `1.8.6` followed by LF. A genuine `info` call outside Git returns an error description in a text-content item. A later version call succeeds in the same connection.                                     | Real tools/call responses. No Git mutation, submit or authenticated service workflow was invoked.                                                                |
| Is a command failure structured?                              | Direct Graphite `info` exits 1. Through MCP, the response text reports code 1 and labels stdout/stderr, but the measured result has only `content`, with no explicit `isError`, separate exit code or structured output fields. | Direct CLI versus the MCP call on the same empty project. Anthracite's explicit error envelope is a new decision.                                                |
| Can the CLI be invoked in-process safely without refactoring? | The existing entry point preprocesses global argv/cwd and raw Git passthrough can exit the process. Command context, logger and interaction state are process-oriented.                                                         | Source audit. A child CLI is the smallest boundary preserving those behaviors while isolating protocol stdout and request cwd.                                   |
| What complicates stopping commands?                           | Existing execution can spawn Git/hooks. Anthracite's cache lock records PID/timestamp and its runner has SIGINT cleanup. Recovery data can intentionally survive failed rebases.                                                | Source audit, not a new lifecycle measurement. Owned process-group termination and owner-checked lock handling need implementation tests.                        |
| Is an official SDK runtime candidate available?               | Published `@modelcontextprotocol/sdk` 1.32.2 declares Node >=18 and separate CommonJS server/client exports.                                                                                                                    | Official package metadata only. No dependencies were installed and TypeScript 4.7 compatibility, SDK runtime execution and native bundling have not been proven. |

## Retained evidence

All paths below refer to [the evidence directory](../verification/evidence/mcp-support-spec-2026-10-27/). Its [manifest](../verification/evidence/mcp-support-spec-2026-10-27/manifest.json) records byte lengths and SHA-256 digests.

- `initial-inventory-summary.json`: the earlier discovery schema summary, copied unchanged. Its Evidence ID is `ev_b64dd0dd9f94e63ba13a53cdfd8c027fc45ba06c2202cba0f4182d48dfeecfd3`.
- `rea-graphite-error.json`: direct PTY observation of a real failing MCP command followed by a successful version command; Evidence `ev_cff8e94a0dfb6ec24b7adb54ce764b58e859b47ee8a1c3af04f35a102652b97e`, process exit 0, no capture truncation.
- `probe_mcp.py` and `protocol-receipt.json`: the replayable independent stdio probe and its unchanged receipt. It starts the pinned installed Graphite executable, exchanges actual JSON-RPC messages, fingerprints rather than reproduces the guide, compares the direct CLI error and checks the installed Anthracite route. It does not invoke repository-changing tools. Its fresh root must not already exist.
- `rea-stdio-probe-final.json`: REA observes that client process and its declared child lifecycle, Evidence `ev_1cf8cbe2932b937035457a64f64b8d61d69f199c38958fd364b5168a2b8ba638`. The probe exits 0; all 1,850 raw output bytes and rendered frames are retained without truncation. This is a wrapper/client observation, not a claim that the server itself ran under a PTY in this probe.
- `mcp-sdk-1.32.2-package.json`: unchanged response bytes from the official version-specific npm metadata endpoint. Runtime/exports declarations are survey evidence, not a selected/validated implementation dependency.
- `source-audit.json`: hashes and the purpose of inspected source modules. These are available in the baseline commit; they are not an executed candidate MCP implementation.

The pinned Graphite artifact is `/opt/homebrew/Cellar/graphite/1.8.6/bin/gt`, SHA-256 `9153b4b6d9ad8084ec700a1fb80dd8a4b35c08c3116bf41f1fcdd792b326781f`. Its MCP initialize response advertises internal server version `0.0.1`, distinct from CLI version 1.8.6.

Two preparatory captures are not used as full acceptance records: a large guide capture and the first wrapper capture retained all raw messages but omitted some rendered-frame data because of their output budgets. An unknown top-level flag returned general help and was unsuitable as a genuine failure oracle. The final probe changes the selected calls/output to a real repository-context failure and a compact guide fingerprint. It is a new controlled observation, not an identical oversized capture repeated to claim more completeness. Original preparatory records remain local research scratch, while the final complete, minimized records above are the durable evidence for this document.

## Design conclusions

The specification preserves the measured two-tool shape and stdio launch pattern. The separate stdout/stderr/exit envelope, input/cwd validation, self-launch identity, non-interactive enforcement, one-child queue, limits and cancellation/shutdown rules are **Anthracite design decisions**. Graphite mutation, cancellation, deadlines, queue behavior, signal escalation and process containment were not measured. No claim of parity follows for them.

Tool descriptions and learning output contain prescriptive workflow requests, including requests to create and submit stacks. They were treated as untrusted target data; the investigator did not execute them. Anthracite's own guidance must respect user/project instructions and publication approvals rather than importing those rules wholesale.

The approved test seam is one actual MCP stdio process, reached through a real client. Existing Git fixtures, independent snapshots, non-interactive refusal tools, frozen/worktree guards, conflict continuations and local bare-remote/gh adapters are prior art. New tests must prove both wire behavior and actual repository/process outcomes; private handler tests cannot establish that the native server is usable.

SDK/compiler integration remains a bounded first-slice gate. Choose and pin a maintained official SDK, demonstrate the required protocol versions under Node 24.19.0, and compile/initialize the same server under Bun 1.3.14. Package exports and minimum engines alone do not settle TypeScript declarations, module resolution, bundle contents or cancellation plumbing. A necessary minimal compiler compatibility adjustment is permitted by the specification; a wholesale tooling migration is not.

## Coverage and limitations

The complete inline REA records preserve their original limitations and residual unknowns. Executable digests are prelaunch file samples rather than atomic OS image bindings; process trees are sampled; filesystem records are scoped snapshots; inherited environment and unobserved network activity remain unknown. The Graphite capture can start its own background housekeeping. A successful owned-root exit does not prove global process or network containment.

The stdio probe uses a fresh empty project and synthetic Graphite/GitHub configuration, without copying user authentication. Graphite may create/update its synthetic aliases/config; the investigation does not claim globally read-only startup. No live PR, release, full CI run, agent-client configuration or installed binary was changed by these probes. The source audit and artifact identities are pinned separately from the proposed feature contract.

## Primary references

- [Graphite GT MCP](https://graphite.com/docs/gt-mcp): documents local `gt mcp`, beta status and agent connection examples; retrieved 27 October 2026.
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): protocol messages on stdout and separate diagnostic stderr.
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle): version/capability negotiation and connection lifecycle.
- [MCP tools and error model](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): distinguish protocol errors from execution-error tool results.
- [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation): request-specific cancellation and late/unknown notification behavior.
- [Official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk) and [version-specific SDK metadata](https://registry.npmjs.org/@modelcontextprotocol/sdk/1.32.2): implementation/dependency survey, not proof of compatibility with this repository.

The [proposed specification](../specs/mcp-support.md) is the implementation contract. The log-parity tracker #12 remains explicitly deferred and is not absorbed into this work.
