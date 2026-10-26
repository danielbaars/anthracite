# Anthracite 0.1.0 — local verification, 26 October 2026

This local release derives from the freeze/unfreeze candidate `ba5737b877c6c77462517cba87f6bcf0235240bd`. Product source changes are string literals and comments only, verified by comparing TypeScript AST structure. Package/workspace identity and executable mappings changed to Anthracite 0.1.0, `an` and `anthracite`. The default preference path is now `.anthracite_user_config`; repository metadata formats remain compatible.

The monorepo build, separate typecheck, changed-source/test ESLint and whitespace checks pass. Focused regression testing finishes with **79 distinct native CLI cases** and **17 JavaScript cases** passing, with no unresolved failures or pending cases. The first native run was 59/60: one assertion still expected version 1.0.1. All three files containing old version assertions were corrected and their 25 cases passed, including that failed case. The full previous 2031-JS/2012-native matrix belongs to the baseline and was not rerun for this branding release.

Both installed commands report 0.1.0 and resolve to the same native executable. Interactive zsh startup registers completion for both commands; actual root and branch completion candidates were checked. An isolated HOME proves preference writes use `.anthracite_user_config` and preserve a deliberately unreadable Graphite-preference sentinel. Existing `ch` and `gt` binaries have unchanged hashes.

Real GitHub smoke tests used installed `~/.local/bin/an`, real Git, real `gh` and the existing private synthetic repository. No test doubles were used:

- [PR 9](https://github.com/danielbaars/graphite-charcoal-e2e-2026-10-21/pull/9): main → base.
- [PR 10](https://github.com/danielbaars/graphite-charcoal-e2e-2026-10-21/pull/10): base → child.
- Created both drafts; modified the base and restacked its child; published both existing drafts; imported the stack by PR number into an independent clone.
- Verified base and then current-child fast-forward with actual commit ancestry, exact branch heads, file contents and clean working copies.
- Added a child commit and converted both existing PRs back to draft.
- Preserved a frozen base through get and sync; unfreezed the imported stack; inspected it through the full `anthracite` alias.
- Captured generated dependency trees, restored the exact approved Dutch title/body text, assigned both PRs to the authenticated user and closed both without merging.

Only synthetic fixture branches were published. No source fork, npm package, Homebrew package or GitHub release was published. Merge queues, organization-specific permissions, external hooks and platform variants other than this macOS ARM64 machine were not exercised.

Native binary SHA-256: `b5047161b5297a2588d83088140fae25d517899aa43e0ec7ea861326d9c7f0ea`. Raw local results and command transcripts: `/private/tmp/anthracite-release-0.1.0/`; a durable subset is retained with the versioned local installation. See `ANTHRACITE-0.1.0.md` for usage and rollback.
