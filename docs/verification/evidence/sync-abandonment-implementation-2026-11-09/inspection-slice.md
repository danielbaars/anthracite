# #154 implementation evidence

Worktree: `/private/tmp/anthracite-154-20261109`; branch `inspect-pending-sync`.
Source-only commit: `3565de39` (excludes the #155-owned helper).

Approved seam: public CLI processes, real temporary Git repositories and bare remotes, controlled `gh` boundary only.

- Red: the first detached conflict inspection returned 1 with `Finish the pending sync before starting another operation` instead of displaying the graph.
- Green: six grouped pending-sync scenarios cover genuine conflict and continuation, all full/short aliases, bounded selection and zero-depth refusal, attached physical checkout after raw abort with staged/unstaged/untracked bytes, changed or missing participant fallback, existing `info`/`children`/`pr`, malformed/mixed/digest/identity refusals. All cases compare refs/metadata, recovery, HEAD, index, files and source pins.
- Additional red: a branch receiving an external commit after raw abort was still treated as the detached pending anchor. The expected-head guard now falls back to trunk.
- Existing compatibility controls: eleven `log_steps_state_cli` cases include ordinary attached/detached behavior, empty/unicode/frozen/needs-restack branches, dirty files, linked cwd/worktree, legacy restack continuation and raw abort preservation.
- Node: 17 passing (six new groups plus eleven existing controls).
- Native: 17 passing (six new groups plus eleven existing controls), compiled using Bun 1.3.14 as `/private/tmp/anthracite-154-native`.
- Typecheck, focused source/test lint, Prettier and `git diff --check` pass.

Tests compiled with Node 24.19.0; production helper `readOwnedSyncRecovery` temporarily copied exactly from #155 for pre-integration tests, then removed from this branch's working tree. #155 integrates first; #154 merges that integration tip before handoff. The helper is never duplicated in this commit. Final branch HEAD `b0ac8fe30afa9a84f9ea4895a5c754592f93e228` merges integration `02f5daa0`; final merged typecheck passes and working tree is clean.

No CI/full matrix, live GitHub mutation, npm publication, user project or active installation changes.
