# #169 — Conflict, legacy and installed deferred landing delivery

Complete. Worktree `/private/tmp/anthracite-169-20261110`, branch `implement-deferred-land-delivery`, clean final HEAD `cab979068b908c9391be99d423ce25dcbdd2aece`.

Started from clean integration `7b5d4be6418b99e5f43add83d5bbeb88bd330ce7`. Latest integration merged before handoff: already up to date.

## Commits and behavior

- `9c2993ac19ee6812f9ee24b095918767a6c51626`: three public delivery regressions, existing fresh-display assertion adapted to the new contract, English landing guide, relevant command help and existing MCP learning.
- `cab979068b908c9391be99d423ce25dcbdd2aece`: root-requested compatibility correction to the lease refusal diagnostic and corresponding existing core assertion. The same actual remote mismatch predicate now throws the existing `captured-OID lease refused survivor push` diagnostic separately from a PR identity mismatch. No refusal authority changed.
- No new option, production test interface, workflow, package version or recovery format was introduced by this slice.

## Public-process acceptance

The existing approved seam is retained: actual public CLI processes, real temporary Git repositories/bare remotes, controlled gh replies, real client pre-push and independent remote post-receive observations. MCP uses the existing SDK stdio client, not a mocked command executor.

1. **Early genuine conflict:** exactly one confirmed merge, zero client pushes/deletions/PR edits before conflict. Deliberate resolution and `continue` preserve every remote ref and gh effect; local author/full message and resolution survive. Explicit landing then completes exactly two feature updates and three deletions without repeating the first merge.
2. **Genuine released version-1 partial maintenance:** unmodified public npm 0.6.15 creates the record after acknowledged child push and failed PR update. Candidate preview preserves its bytes and does not claim deliberate deferral. Candidate resumption keeps the eager `child, tip, tip` publication sequence, no duplicate child push/merge and the current required-only check gate despite optional failure. The core #166 case separately covers a genuine legacy record paused after confirmed merge/check maintenance; neither case hand-edits a version field.
3. **Actual MCP across sessions:** learning/help explain scheduling and downgrade boundaries. Preserving fresh plan, required-check pause with tip deliberately unpublished, SDK disconnect/reconnect, preserving saved preview and explicit resumption complete the three-PR stack with two feature updates plus three deletions. Actual remote receipts match every client transaction; final tree is preserved.

## Recorded campaigns

| Receipt | Result | Source/runtime boundary |
| --- | --- | --- |
| `169-red-guidance.json` | 0/1, expected missing learning guidance | Before guidance implementation; red is factual, not a functional scheduler failure |
| `169-mcp-node.json` | 1/1 | New MCP/learning workflow; Node24.19.0 |
| `169-conflict-node.json` | 1/1 | New conflict/local-only continuation workflow; Node |
| `169-legacy-node.json` | 1/1 | New public0.6.15 partial-maintenance workflow; Node |
| `169-display-node.json` | 9/9 | Existing fresh/resumed presentation cases, including real declining confirmation; lease-diagnostic-only change occurred during this campaign and is separately checked below |
| `169-delivery-display-native.json` | 12/12, 315688ms | Immutable native built from delivery source9c2993ac before lease-diagnostic delta; three new plus nine existing display cases |
| `169-lease-node.json` | 2/2 | Final cab97906 source; original concurrent survivor lease and new deferred foreign-head refusal |
| `169-lease-native.json` | 2/2 | Final immutable native cab97906; same two affected controls |
| `169-installed-core-mcp.json` | 2/2 | Initial isolated npm candidate: core straight three-PR exact count plus preserving MCP pause/reconnect/resume |
| `169-installed-final-delta.json` | 3/3, 103684ms | Rebuilt exact final npm candidate: both lease controls plus full real MCP three-PR count/plan/resume workflow |

These are overlapping focused campaigns, not a sum of distinct new scenarios. New delivery scenarios total three. No full-suite or live GitHub claim is made.

## Artifacts and static checks

`169-artifacts.json` retains initial artifact identities; `169-artifacts-final.json` binds the final `cab97906` production inputs, native/tarball/installed-CLI checksums and exact released legacy producer checksum. The final npm tarball is `/private/tmp/anthracite-169-20261110/release/npm/danielbaars-anthracite.tgz`; isolated final executable `/private/tmp/anthracite-169-npm-final-installed/node_modules/.bin/an`; final native `/private/tmp/anthracite-169-native-final-20261110`.

The candidate deliberately retains development workspace version0.6.15; it is not the published0.6.15 artifact. Builds used Node24.19.0/Bun1.3.14. npm used isolated cache and offline installation with scripts/audit/funding disabled. Existing package tooling and active installation were not changed. Build/install transcripts and SHA256SUMS remain alongside the process-generated JSON receipts.

TypeScript build/typecheck, ESLint for changed source/new tests plus changed existing display assertion, Prettier and `git diff --check` pass. The source correction did not repeat unrelated campaigns; its affected controls and rebuilt package were checked directly.

## Limits

No pushes, PR/issue mutations, live GitHub fixtures, CI/full matrix, npm publication, active installation/MCP-registration changes or user-project changes. Published-sibling final-trunk scope and the two known unrelated baseline recovery defects remain unchanged. Real-service intermediate presentation, triggered Actions-run reduction and billing remain unmeasured. Parent owns aggregate evidence, final independent reviews and the one integration PR.
