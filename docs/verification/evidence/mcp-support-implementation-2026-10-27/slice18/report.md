# #18 measured MCP workflow outcomes

Candidate test commit: `4f40f26065f4be33a4a6a4636d9554f790196cad` on `mcp-real-stack-workflows`, directly above integrated #15 `bd6da220203fb3881cab461ecef515cc60dab3b4`. Worktree is clean; rebase to the current canonical branch was already up to date. Only `apps/cli/test/commands/mcp_workflows_cli.test.ts` changed. Production source and the shared MCP client helper are unchanged.

Public seam: official SDK client over stdio to the built CLI, existing Cwd/Relation and Submit fixtures, real Git state and local bare remote, existing external fake gh adapter. No engine mocks or private handlers.

## Results

| Scenario | Node | Native | Independently observed outcome |
| --- | --- | --- | --- |
| 5 | Pass | Pass | Real amend and substantive explicit restack; fixed-date commits, parents, trees/messages/files equal separate direct CLI control; other stack unchanged. |
| 9 | Pass | Pass | Frozen modify and occupied-tip reorder return real CLI error; complete opaque metadata/refs/raw indexes and dirty main/linked files preserved; later parent calls succeed. |
| 10 | Pass | Pass | Genuine conflict preserves partial rebase/continuation; unresolved continue leaves it unchanged; idle close preserves it; fresh session reaches the second conflict then completes after fixture resolution. Final commits/trees/messages/parents/files/continuation equal direct CLI recovery; dirty linked checkout unchanged. |
| 11 | Pass | Pass | Explicit target stack pushes to local bare remote with correct base/draft/dependency metadata, retaining approved title/body/reviewers and dirty unrelated branch/PR/remote. Real pre-push hook sees fixture environment. Discovery/learning causes no gh call, push or hook. |

Final combined run: Node 4 passed / 0 failed / 0 pending in 119712 ms; native 4 passed / 0 failed / 0 pending in 99221 ms. Node 24.19.0; SDK 1.32.2; TypeScript 5.5.4; Bun 1.3.14.

Genuine red control: the first scenario fails against the #14 native artifact with MCP -32602 "Unknown Anthracite tool", then passes through integrated #15. No artificial stub or implementation mutation was used. Existing #15 behavior already satisfied every new workflow; no adapter fix was necessary.

Forced checked-in Yarn build (0 cached tasks), workspace no-emit typecheck, uncached source + new-test ESLint and staged diff whitespace checks all pass. Final test file SHA-256: `4cfb221225ec5d53eff97f1660eecd9753b8bac270df52abdef125afba201a91`. Native executable SHA-256: `2debdb1abfdbbfdcf8c86f76bfd214632f4a284aebfee5e722c1fd91b1b3ca70`. The binary contains the unchanged production source at the base; the candidate adds test coverage only.

## Evidence

`receipt.json` records identities, commands and exit codes. `node-final.json` / `native-final.json` are complete Mocha JSON reports. `node-final/` / `native-final/` contain per-scenario outcomes, Git observations and representative MCP response records. `red5-native14.log`, build/check/lint and native-build logs retain the relevant receipts. `manifest.json` hashes those final evidence files.

Turbo build inputs cover source/package metadata but exclude tests; use `--force` (as done for the final run) or explicit TypeScript emission before running changed tests.

No full matrix, broad engine suites, push, real PR, Actions, release, global installation or client registration was performed. The root coordinator owns final integration validation and durable in-repository evidence consolidation.
