# Landing push-hook selection — #213

## Scope and source

Local fix for [#213](https://github.com/danielbaars/anthracite/issues/213), tested on 19 November 2026 as a working-tree candidate based on `d5d2ec83e4881b5b8f5c4d24e4e98ba5562f4bb1`. The [provenance record](evidence/land-no-verify-2026-11-19/provenance.json) identifies the changed source bytes, tools, candidate artifacts and genuine published recovery producers. No package was published and no active installation was changed. The package manifest remains development version 0.9.3; the candidate is distinct from public npm 0.9.3.

## Before and after

The [red public CLI regression](evidence/land-no-verify-2026-11-19/red.txt) fails because a fresh `land --no-verify` still invokes a deliberately failing project pre-push hook after its first confirmed merge. Both survivor publication and remote deletion hardcoded `noVerify: false`.

The current invocation now carries its hook choice through fresh application, resumption, survivor publication and remote cleanup. The existing frozen push wrapper stays active; only the original project pre-push hook is skipped. Hook selection is not saved in landing recovery, so supported old records need no migration. Hooks remain enabled by default and with `--verify`. Remote deletion retains its captured-head lease, local validation and readback checks.

## Executed acceptance

- **Node: 9 passed**, with no failures or pending cases ([output](evidence/land-no-verify-2026-11-19/node.txt)).
- **Native: 9 passed**, with no failures or pending cases ([output](evidence/land-no-verify-2026-11-19/native.txt)).
- **Isolated installed npm: 3 passed**, with no failures or pending cases ([output](evidence/land-no-verify-2026-11-19/npm.txt)). The tarball was built once from the tested emitted CLI and installed offline with lifecycle scripts disabled into a temporary prefix.
- TypeScript build and no-emit checks, focused ESLint, source/Markdown/workflow formatting, actionlint and source diff checks pass.

The runtime selection contains seven new public CLI workflows plus two existing guards. It covers every maintenance update and deletion in a clean three-PR landing; default hook refusal and explicit resumption for update and cleanup failures; preserving dry-run inspection; re-enabling hooks on a later invocation; server-hook and required-check refusal; and resumption from genuine published 0.6.15 version-1 and 0.9.3 version-2 records without repeating confirmed merges. The existing deletion-lease race and frozen-sibling cases remain green. The installed selection covers clean updates/deletions, cleanup resumption and per-invocation/server-hook behavior.

Tests use actual CLI subprocesses, temporary Git repositories and bare remotes. GitHub responses are controlled only at the established gh boundary. No internal landing implementation is mocked. The commands select `land_verify_cli.test.js` plus the existing `land_leaf_cli.test.js` deletion-lease race and `land_fanout_cli.test.js` frozen-sibling guard. Genuine producer executables are supplied through `ANTHRACITE_TEST_LANDING_V1_PRODUCER` and `ANTHRACITE_TEST_LANDING_V2_PRODUCER`; `ANTHRACITE_TEST_BINARY` selects native or isolated installed CLI execution.

## Boundaries

No live GitHub fixture, user project or active configuration was modified. No Actions workflow or full CI matrix was started. Ordinary CI gains only the focused default-cleanup/explicit-resumption case. The complete npm packaging suite and full regression matrix were not run; packaging and the shared push wrapper did not change. Automatic hook skipping for default cleanup and a general landing abort/adopt-head route remain separate work. Raw test stdout is retained unchanged.
