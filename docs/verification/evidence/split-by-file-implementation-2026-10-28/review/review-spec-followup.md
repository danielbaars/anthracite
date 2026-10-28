## Spec follow-up

**The reported P2 is resolved in source at `4040d758c9c4ae7da3a10f3bc56f0570be4a1eb0`.** Reviewed only the fix diff from `5d49b4912eab40aaca8557ec2f8502e5878ec9ec`; no additional probe or test suite was run.

`/private/tmp/anthracite-split-implementation-2026-10-28/review-fixes/apps/cli/src/actions/split_file_plan.ts:63` now discovers the checked-out source with `git branch --show-current`, matching the existing branch-discovery behavior and avoiding ambiguous symbolic-ref shortening. Detached HEAD still yields an empty name and retains its explicit refusal. This satisfies the specification's “physically checked-out, locally tracked, non-trunk source” requirement at `docs/specs/split-by-file.md:92` for the reported tag collision.

The existing public single-own-commit case at `/private/tmp/anthracite-split-implementation-2026-10-28/review-fixes/apps/cli/test/commands/split_file_surface_cli.test.ts:87` now places tag `base` on a deliberately different unrelated commit, then requires successful extraction and mandatory replay. Its Git tree/ref oracles explicitly qualify branch refs, and it asserts the tag/unrelated branch remain unchanged while the source ref is rewritten. This is an adequate regression for the original defect without adding a new fixture or broadening production scope.

Inspected retained targeted reports: the case fails with the original diagnostic on both previous Node/native candidates and passes once on each fixed runtime, with zero failures/pending. Original review and probe records remain unchanged.

This resolves the finding; it is **not a declaration of full fixed-candidate acceptance**. The coordinator's full 62-feature-plus-five-controls runs and their final source/native identity reconciliation remain ongoing and require separate confirmation before publication. No new spec finding in this narrow follow-up.
