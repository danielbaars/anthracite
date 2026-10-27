# Zero-depth log verification — 27 October 2026

This records the implemented acceptance boundary for [spec #1](https://github.com/danielbaars/anthracite/issues/1) and tickets [#2](https://github.com/danielbaars/anthracite/issues/2), [#3](https://github.com/danielbaars/anthracite/issues/3), [#4](https://github.com/danielbaars/anthracite/issues/4) and [#5](https://github.com/danielbaars/anthracite/issues/5).

## Tested implementation

Implementation commit: `9c14f9738b662391c78c412d410306993a0e6c69`. Node v24.19.0 and Bun 1.3.14 were used on macOS ARM64. The native candidate was compiled separately from the integrated build; the installed release was not used for acceptance.

Native SHA-256: `2e1a3cc14049570dfa7e2eb461116fe43d23329e37bb5435a16a4ec1e455a7f0`.

The [integration provenance](evidence/log-steps-zero-2026-10-27/integration-provenance.json) pins the source tree, source files, compiled JavaScript, native candidate and scenario identities. This documentation/evidence addition does not change that implementation.

## Integrated focused results

| Public CLI suite | Node | Native |
| --- | --- | --- |
| Full log, zero spellings and aliases | 11 passed | 11 passed |
| Short log, aliases and hidden-child fanout | 17 passed | 17 passed |
| Branch states, local work, worktrees and recovery | 11 passed | 11 passed |
| Options, classic/long, pipes and real PTY/pager | 10 passed | 10 passed |
| **Total** | **49 passed; 0 skipped** | **49 passed; 0 skipped** |

All scenario identities and their multiplicity match between runtimes. Fresh subprocesses used real Git repositories, isolated configuration and fixed fixture dates. Branch identity and commit content were asserted independently; successful exit alone was not an acceptance oracle.

- [Node summary](evidence/log-steps-zero-2026-10-27/integrated-node-focused-summary.json) and [complete focused evidence](evidence/log-steps-zero-2026-10-27/integrated-node-focused.tar.gz).
- [Native summary](evidence/log-steps-zero-2026-10-27/integrated-native-focused-summary.json) and [complete focused evidence](evidence/log-steps-zero-2026-10-27/integrated-native-focused.tar.gz).

## Demonstrated failures and corrections

The preserved red runs distinguish genuine product failures from test-authoring corrections:

- Full/short zero depth displayed trunk instead of the checked-out child, despite exit status 0.
- Zero combined with stack selection retained unwanted ancestors.
- A current branch with three children could trigger negative short-format padding; zero now omits connectors for hidden descendants.
- A genuine restack conflict let saved recovery override a physically detached checkout; zero now refuses meaningfully.
- A direct Git rebase abort left genuine saved continuation which ordinary context cleanup deleted; zero now uses the existing preserving inspection context.

An initial Unicode test assertion incorrectly expected a combined hash/subject string. Its corrected oracle and history are recorded as test authoring, not as a product regression.

Per-ticket provenance and unchanged raw observations:

| Ticket | Provenance | Raw evidence |
| --- | --- | --- |
| #2 | [Full](evidence/log-steps-zero-2026-10-27/ticket-2-provenance.json) | [Archive](evidence/log-steps-zero-2026-10-27/ticket-2-full.tar.gz) |
| #3 | [Short](evidence/log-steps-zero-2026-10-27/ticket-3-provenance.json) | [Archive](evidence/log-steps-zero-2026-10-27/ticket-3-short.tar.gz) |
| #4 | [State/recovery](evidence/log-steps-zero-2026-10-27/ticket-4-provenance.json) | [Archive](evidence/log-steps-zero-2026-10-27/ticket-4-state.tar.gz) |
| #5 | [Options/transport](evidence/log-steps-zero-2026-10-27/ticket-5-provenance.json) | [Archive](evidence/log-steps-zero-2026-10-27/ticket-5-options.tar.gz) |

Each archive has a sibling `.manifest.json` with original member sizes and SHA-256 values. Archive members were read back and verified byte-for-byte against their recorded source hashes; the raw evidence itself was not rewritten.

## Review and project checks

The integrated build, lint and typecheck passed. Independent [standards](evidence/log-steps-zero-2026-10-27/review-standards.md) and [specification](evidence/log-steps-zero-2026-10-27/review-spec.md) reviews found no actionable issues.

The repository's [normal CI](../../.github/workflows/ci.yml) runs the complete per-file Node suite and native command suite and preserves their JSON reports for the exact PR head. Full-project status and any platform-dependent skips are separate from the zero-skip focused results above. The external large-repository benchmark remains outside the regular suite.

This is implementation verification, not a release or global installation. Graphite accounts, backend access and live GitHub PR fixtures are not required for these acceptance tests. General renderer parity, multi-trunk support and numeric policy changes remain outside #1.
