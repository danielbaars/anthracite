# Spec review

Reviewed `e201e0629c547f3c88845ab37a9bf64555f21c19...0ccd60b8d55f2b7f138621848b8679cae5c50058` against the complete `docs/specs/mcp-support.md`, supporting research and issues 13–18. Read-only review; no new test run or production changes.

**No actionable spec findings.**

- **Missing/partial requirements:** None identified in the implementation. The official SDK handles protocol/discovery and request cancellation; the child boundary preserves literal arguments, explicit directory authority, same-build identity, non-interactive policy, credentials, stream separation and actual process status. FIFO execution, output/deadline limits, cancellation, EOF/signals and owned cleanup match decisions 4–9 and 12–16.
- **Unrequested scope:** None identified. The compiler/declaration adjustment is the permitted compatibility gate. The two-line SDK cancellation patch repairs valid request ID zero handling without a parallel protocol. The cache-lock owner check implements the required foreign-lock preservation. Deferred log parity, global installation, client registration and live publication fixtures remain excluded.
- **Requirements implemented incorrectly:** None identified. Learning and generic client documentation preserve user/repository authority and existing publication approvals, describe supported commands and credentials, and avoid rollback or automatic-retry claims.

The five public stdio suites cover all fifteen approved scenarios, including independent Git outcomes, real conflict/reconnection/continue, controlled submit, output boundaries, FIFO/request association, cancellation and owned descendants. Available Node/native focused receipts and process observations support those assertions. The native Bun signal value is preserved as observed; independent process records establish cleanup rather than inferring it from that signal alone.

Limits: macOS host evidence does not establish Linux `/proc` zombie behavior or all-platform certification. Final evidence packaging, the single integration PR and allowed cheap CI remain delivery work for the coordinator; this review does not claim publication or CI completion.
