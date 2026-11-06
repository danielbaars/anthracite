# Reused branch PR identity: specification evidence

## Scope and baseline

The user approved one public CLI test boundary on 2026-11-06 for [issue #139](https://github.com/danielbaars/anthracite/issues/139). The proposed [specification](../specs/reused-branch-pr-identity.md) covers submit selection, preserving PR inspection and safe terminal-PR cleanup in one implementation PR.

These are observations of the published **0.6.11**, not implementation acceptance. The public tarball and publishing provenance were independently verified during the preceding release. Its source is [1ae171c08a3e23ae3eb4b0274266a5a5f1dbdb1a](https://github.com/danielbaars/anthracite/tree/1ae171c08a3e23ae3eb4b0274266a5a5f1dbdb1a). The [baseline record](reused-branch-pr-identity-2026-11-06/baseline.json) retains package/source/artifact identities and digests of the preserved inputs.

All observations use synthetic real Git repositories and local bare remotes, with controlled `gh` process answers. There were no live test PRs, GitHub writes, CI runs or changes to user projects. The installed binary was isolated from the active installation.

## Retained observations

| Case                                          | Observed 0.6.11 outcome                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One historical merged PR, local tip different | `pr` displays the old PR. Inspection does not write an association.                                                                                          |
| Submit of the reused name                     | Push succeeds; the old PR receives a draft-transition attempt; the fixture rejects that invalid transition and submit fails with partial-progress reporting. |
| Two historical matches                        | Inspection reports ambiguous association before excluding unrelated historical heads.                                                                        |
| Sync without a stored PR number               | New branch is retained as local-only, even with explicit cleanup consent.                                                                                    |
| Sync with a retained old PR number            | The old merged status makes cleanup delete the new branch when `--delete-all` consents to cleanup.                                                           |

The [unchanged observation output](reused-branch-pr-identity-2026-11-06/observations-0.6.11.json) includes actual temporary Git commit identities and output. Its machine paths refer only to disposable synthetic fixtures. A prior head was squash-merged locally, its branch removed, and a new branch with the same name and unique work created. This is not a live claim about the report author's repository.

The [original issue report](reused-branch-pr-identity-2026-11-06/original-issue-139.md) is retained unchanged before the issue body becomes a specification. Two report interpretations need correction: the shared inspection lookup does not persist metadata, and sync's selection already skips terminal PRs for unassociated branches. The reproduced cleanup failure therefore has the explicit additional condition of a retained old association and cleanup consent. The open-only lookup in the shared remote graph adapter is conditional, not the general behavior for every named branch.

## Reproduction

The [observation harness](reused-branch-pr-identity-2026-11-06/reproduce.cjs) uses the existing compiled submit fixture and the installed public CLI. Input/output locations are parameterized, and the baseline version and sync outcomes are asserted explicitly. The scenarios retain the observed broken baseline. It deliberately asserts 0.6.11 behavior and is **not** the acceptance suite for a repaired version.

Use a trusted checkout at the pinned source with its test fixtures compiled using the documented pinned development tools. Obtain and verify public 0.6.11 in an isolated prefix; do not replace the active installation. Set the following variables to those absolute locations, choosing an output JSON path outside tracked files:

```sh
ANTHRACITE_TEST_BINARY="$INSTALLED_PUBLIC_AN" \
ANTHRACITE_139_FIXTURE_MODULE="$CHECKOUT/apps/cli/dist/test/lib/fixtures/submit_cli.js" \
ANTHRACITE_139_OUTPUT="$EVIDENCE/observations.json" \
node "$SPEC_CHECKOUT/docs/verification/reused-branch-pr-identity-2026-11-06/reproduce.cjs"
```

The harness creates and removes its own temporary repositories. `gh` commands are handled by the fixture, including delegated calls to its controlled original shim. There is no live GitHub fallback. Synthetic branch deletion is part of reproducing the cleanup failure. Repeated runs produce different temporary paths and commit hashes; the asserted behavioral outcomes are the evidence.

## Contract choices for implementation

- Prefer a unique valid open PR for updates and filter historical candidates before ambiguity checks.
- Use exact head equality for unassociated historical discovery. Ancestry would attach new work to already landed history.
- Treat branch/PR association, permission to mutate a PR, and permission to delete local work as different facts.
- Do not let terminal PR state cover unpublished commits that its head does not contain. Preserve existing independent local proof and explicit selected-branch force authority.
- Preserve ordinary landed cleanup, the fresh-state deletion fix for #136 and existing pinned-identity recovery contracts. Do not trade a wrong-PR update for accidental branch deletion.

Implementation acceptance uses the user-approved public CLI boundary, focused Node/native and installed npm checks. No new internal test-only interface, live PR fixture, specification-time CI or full validation matrix is needed.
