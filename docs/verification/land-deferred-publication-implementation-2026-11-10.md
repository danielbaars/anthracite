# Deferred landing publication: implementation record

Specification: [deferred publication](../specs/land-deferred-publication.md), parent [#165](https://github.com/danielbaars/anthracite/issues/165). Baseline main: `a3c9f7055c7a42dfe38daee8fb843f21e1763474`.

## Current status

The first integrated slice is [#166](https://github.com/danielbaars/anthracite/issues/166), implementation `59ac516929f76167f4e015583f99e66f659f656e`, integrated by `7cff723d5f6a2c9acd9c740f890563c47ed1d22a`. #167 and #168 continue in the same integration PR; #169 follows their integration. This is a checkpoint, not final acceptance of the parent specification or a released CLI.

## Core execution evidence

The first public-process [red case](evidence/land-deferred-publication-implementation-2026-11-10/core/166-red.txt) observed child, tip, tip publication on baseline instead of the intended child, tip updates.

Initial full campaigns passed five cases on [Node](evidence/land-deferred-publication-implementation-2026-11-10/core/166-node.json) and [native](evidence/land-deferred-publication-implementation-2026-11-10/core/166-native.json). These include the three-PR chain, seven-PR chain, seven-target published-sibling/local-only pause/resume, a genuine public 0.6.15 version-1 operation resumed eagerly, and invalid record refusal.

The strengthened four-case [Node](evidence/land-deferred-publication-implementation-2026-11-10/core/166-final-node.json) and [native](evidence/land-deferred-publication-implementation-2026-11-10/core/166-final-native.json) campaigns pass with exact **5 / 13 / 14 client push invocations**, single-ref transactions and independent bare-remote acknowledgements, plus refusal of a changed deferred remote head. The seven-target case has six feature updates plus seven deletions; adding the published sibling adds one feature update. No setup or simulated server trunk pushes are included in client totals.

Expanded invalid-version/missing-version-2-lease controls pass on [Node](evidence/land-deferred-publication-implementation-2026-11-10/core/166-malformed-node.json) and [native](evidence/land-deferred-publication-implementation-2026-11-10/core/166-malformed-native.json), retaining local state, saved bytes and no service effects. [Producer identity](evidence/land-deferred-publication-implementation-2026-11-10/core/legacy-producer.json) pins the unchanged public npm 0.6.15 executable; no old recovery state is manufactured by changing a new record's version. Counts from overlapping campaigns are not added as unique scenarios.

The shared schedule derives due/deferred selection from version, captured merge order and phase, rather than adding a second mutable queue. New records use version 2. Version 1 stays eager. Local replay, original affected ancestry and non-target survivor publication remain unchanged. Deferred participants still undergo fresh identity/lease checks before skipping their remote writes.

## Remaining acceptance

Preserving conditional plans/readiness (#167), interrupted/partial publication (#168), and full conflict/legacy/installed CLI/MCP delivery and guidance (#169) remain pending at this checkpoint. The parent is not ready for review until those slices, local final checks and the independent Standards/Spec reviews are complete.

The previously measured foreign-continuation unmerged-index assertion and removed-original-target preview failure remain documented [baseline issues](land-required-checks-2026-11-09.md), not unreported new failures or silently repaired scope.

## Boundaries

Evidence uses public CLI processes, real disposable Git/bare remotes and controlled gh responses. Raw records are retained byte-identically with [checksums](evidence/land-deferred-publication-implementation-2026-11-10/core/SHA256SUMS). Core typecheck, source/new-test/observer lint and whitespace checks pass. No production GitHub fixture, frontend-packages, other user project or active installation is changed. No npm release or full CI matrix is started; publication of this implementation PR permits only existing ordinary CI.
