# Move selector fixture diagnosis

The original second CI failure is preserved unchanged under original-ci. Native shard 3 ran nine move-selector cases; the leaf-only case failed its original final assertion with expected `other`, actual `main`.

The exact existing public CLI case initially passed locally. Three successful cases in the file use the same positional one-Up input while all intend the branch named `other`.

## Red-capable control and baseline

A newer empty trunk checkpoint and a committer-date tie between base and departure deterministically alter the selector positions. The first probe also exposed the changed trunk through the existing own-history assertion. Aligning departure `other` onto that checkpoint through the public restack command isolates the original selection symptom while retaining every original assertion.

With the old one-Up input, the controlled case now fails the exact original final assertion: expected `other`, actual `main`. The same controlled command fails identically against the verified Anthracite 0.1.1 baseline, SHA-256 `6b81017ae0b7cb018c698fd5e25c074d15aed726bcbe2451cab2c6864999091e`. This ordinal test-input assumption predates the zero-depth log correction.

The prepared Git dates are relative to the existing base commit and any inherited committer-date setting is restored. No delay or retry is used.

## Correction

A small local helper serves the three identical successful selector interactions. It types the unique target name `other` and waits for the completed filtered prompt plus selected-row marker before Enter. Pending suggestion output uses the ellipsis marker; the completed filter has `› other` followed by the selected-row glyph. FORCE_COLOR is removed only from those fixture environments so raw ANSI decoration cannot interrupt acknowledgment.

The cancellation, invalid-input, source/departure, excluded-descendant, commit-content, preserved-ref and parent-navigation assertions remain unchanged. The adversarial leaf setup remains as regression coverage for the original ordinal assumption. Production code and shared fixture policy do not change.

The complete file passes 9/9 on Node and 9/9 on its separately compiled native candidate. All three successful selector interactions also pass 3/3 on each runtime with fixed dates and inherited FORCE_COLOR=1, with matching identities and zero skips. Final source and binary identity and the unchanged original CI failure are recorded in provenance.json. The root workflow owns integration, publication and CI at the new PR head.
