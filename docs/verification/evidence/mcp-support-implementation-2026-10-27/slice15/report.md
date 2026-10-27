# Anthracite MCP ticket #15

Source branch: `mcp-command-execution`.
Initial base: `95b1c619d0bc904ebae606554100d404ec3bf4ba` (verified clean before changes).
Implementation commit: `bd6da220203fb3881cab461ecef515cc60dab3b4`.

Implemented the final static two-tool inventory and real same-build CLI execution. Input validation, shared cwd scan/yargs documentation classification, exact captured UTF-8 output/exit envelope, forced child non-interactive policy, closed stdin, literal arguments and recursive-server refusal are covered at the public SDK/stdio boundary. Command registration remains explicit for native bundling; its inherited command-module typing boundary is preserved.

## TDD and runtime receipts

- `red-01.txt`: scenario 3 fails with the SDK's unknown-tool protocol error before execution exists.
- `green-01.txt`: real log/info bytes match direct CLI and PATH sentinels remain untouched.
- `red-02.txt`: contradictory consumed CLI cwd override incorrectly returns a CLI result.
- `green-02.txt`: malformed inputs, cwd validation/equivalence, real literal create and recovery pass.
- `red-03.txt`: disabled completion prefix can evade recursive-MCP classification.
- `green-04.txt`: same yargs classifier rejects that startup request without changing completion's documentation classification.
- `native-results.txt`: native execution initially fails because Bun preserves the original CJS `__dirname`.
- `native-runtime.cjs` and `native-runtime`: independent compiled runtime probe confirms `process.argv[1]` uses the embedded `/$bunfs/` path while `process.execPath` identifies the compiled executable. Self-launch now selects its prefix from that resolved identity before any request cwd.

The final directed selection is `mcp_execution_cli`, `mcp_cli`, `cwd_selection_cli`, `cwd_documentation_cli`, and `interaction_explicit_editor_cli`.

Execution scenarios 3, 4, 7 and 8 cover inspection/direct CLI byte equivalence, same-build PATH refusal sentinels, independently verified branch/parent/commit identity/files, literal Unicode and shell-looking messages, invalid inputs and inaccessible/contradictory cwd, protocol versus tool errors, session recovery, no UI, stdin EOF, recursive prefixes/docs, quiet/debug and raw-Git literal boundaries. Source and changed tests pass uncached ESLint and Prettier; workspace no-emit check passes. `node/` and `native/` retain SDK wire messages, separate stderr and real fixture observations.

Queue/output/deadline/process-group bounds belong to #16; cancellation/shutdown belongs to #17, protected workflows to #18. No push, PR, workflow dispatch, release, installation or client registration was performed. Worktree and private dependencies are retained for integration.

## Final acceptance

- Node: 39 passing, 0 failed, 0 skipped (`node-acceptance.txt`, 4m).
- Native: 39 passing, 0 failed, 0 skipped (`native-acceptance.txt`, 3m).
- Included on each runtime: 4 ticket-15 execution cases, 7 startup/learning controls, 8 cwd-selection controls, 6 cwd-documentation controls, 14 explicit-editor controls.
- Final full local build: successful, CLI cache miss (8.716s); workspace check successful (`build.txt`).
- Uncached complete source + changed-test ESLint: exit 0 (`lint.txt`); formatting check: exit 0 (`format.txt`).
- Tested native executable SHA-256: `045dc9371df730609981be29c3d1b6b779be1b56b2de501e192c51b63767753c`.
- Rebased own commit onto current `mcp-support-spec` (`95b1c619d0bc904ebae606554100d404ec3bf4ba`); already up to date. Final worktree clean; no generated tracked logs changed.
