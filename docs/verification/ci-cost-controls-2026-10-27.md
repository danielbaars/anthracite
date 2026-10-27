# CI cost controls — local verification, 2026-10-27

The automatic workflow now runs one ten-minute Node job instead of the complete eight-job matrix. It builds/lints, typechecks and runs eight smoke files. Documentation-only updates skip automatic CI. Both workflows cancel superseded runs on the same ref; the complete matrix fails fast. Artifacts expire after seven days.

The complete Node/native suite moved to `full-ci.yml`, which accepts only manual dispatch. Its `release_assets` boolean defaults to false and its asset job depends on successful tests. The full suite remains the final acceptance gate; full validation with assets remains mandatory for releases. Contributor instructions describe scope, runtime estimates and manual activation requirements.

## Local checks

- Immutable dependency installation passed with the existing root `ts-mocha`/`mocha` peer warning; dependencies and lockfile did not change.
- Forced build/lint passed for both workspaces with zero Turbo cache hits; typecheck passed.
- `actionlint` 1.7.12 validated both workflow files. Prettier passed for the changed workflows and contributor instructions; `git diff --check` passed. The historical zero-depth verification document already failed a whole-file Prettier check at the baseline; its only change is the CI gate description, without unrelated reformatting.
- Assertions against the parsed workflow files verified automatic job count/time limit, documentation filters, the manual-only trigger, default-disabled release assets, test dependency, unfiltered full matrix, fail-fast, cancellation and retention. Test and release execution steps, excluding artifact upload policy, match the baseline workflow exactly.
- The smoke command and environment were read directly from the new YAML and executed through the existing test runner on macOS ARM64 with Node 24.19.0: **8 files, 71 passing tests, 0 skipped, 0 failed**. The reported file set was checked against the eight intended files.

[Unchanged runner summary](evidence/ci-cost-controls-2026-10-27/smoke-summary.json) and [validation provenance with workflow hashes](evidence/ci-cost-controls-2026-10-27/validation.json) preserve the results.

No native full suite, release build or GitHub-hosted execution was started for this tooling-only change. No push, workflow dispatch, rerun or billing change was performed. The configuration remains local until publication; the GitHub default branch still contains its previous workflow. Local checks do not claim to verify live GitHub path filtering, cancellation or runner timing.
