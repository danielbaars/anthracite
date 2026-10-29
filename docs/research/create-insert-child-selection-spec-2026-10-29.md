# Targeted create insertion: specification basis

Research/specification date: 29 October 2026. The owner approved the public testing boundary and requested publication of a full English specification. This note traces that specification to already measured behavior; it is not implementation acceptance.

## Sources and authority

- The [pushed parity report](https://github.com/danielbaars/anthracite/blob/62dda56149dea36f47bd47aa34f3886ea1a1962e/docs/research/insert-parity-2026-10-29.md) binds the actual Graphite 1.8.6, npm Anthracite 0.3.0 and Charcoal 1.0.1 artifacts. It includes 30 accepted scenario records, an additional Graphite restack and two fresh continue commands, with independent Git/parent observations. It preserves cleanup, timeout and execution-environment qualifications.
- The [pinned source comparison](https://github.com/danielbaars/anthracite/blob/62dda56149dea36f47bd47aa34f3886ea1a1962e/docs/verification/evidence/insert-parity-2026-10-29/source-comparison.json) establishes identical blobs for all 21 examined source/docs/test modules at Anthracite release 9fa53077d9c7a52bc2b903799ab9b7a74da2d8ba. The source inspection establishes implementation structure and existing test intent, not new executed test passes.
- The owner's approved boundary uses the existing built public CLI over real Git, a real PTY for selection, focused Node/native controls and one isolated installed npm/MCP smoke. Repository glossary vocabulary and existing create/freeze/recovery behavior remain the basis; no relevant ADR was present in the inspected documentation tree.

## Observed fact versus new contract

| Basis | Specification decision | Evidence class |
| --- | --- | --- |
| Graphite interactively offers a subset; Anthracite and Charcoal move all children. | Add terminal multi-selection when there are multiple children; retain zero/one-child defaults. | Measured baseline; new Anthracite behavior is proposed. |
| Graphite initially selects all and requires at least one choice. | Initially select all; keep the menu active when a user tries to confirm none. | Measured interface reference. |
| Both tools move all children without a terminal or with --no-interactive. | Preserve that noninteractive default when explicit choices are absent. | Measured compatibility behavior. |
| No explicit child-list flag appears in the tested Graphite help or current Anthracite interface. | Add repeatable --insert-child as an Anthracite agent extension requiring active insert, with exact literal names. | Authored interface decision; not an observed Graphite capability. |
| Graphite can exclude a frozen/occupied right arm and move only the left; Anthracite cannot choose that subset. | Derive mandatory protection/replay from the chosen roots; preserve unselected branch identities and foreign worktrees. | Measured capability gap and deliberate safety boundary. |
| With all roots selected, Graphite can change protected parent metadata and skip physical replay; Anthracite refuses beforehand. | Retain Anthracite protection for actual mandatory participants. | Measured policy difference; not targeted for parity. |
| Graphite commits before selection and in the cancellation fixture restores branch relations and staged content, while raw index bytes change. | Select before staging/checkout/creation; guarantee user-visible work/topology preservation without universal raw-administration rollback. | Measured reference plus deliberate simpler ordering. |
| Graphite create can succeed with a needs-restack warning; Anthracite enters a real conflict and returns nonzero. | Preserve Anthracite's explicit conflict failure and existing continuation policy. | Measured policy difference; changing it is out of scope. |
| Both paired conflict workflows finish with deliberate resolution and new-branch checkout. | Resume only chosen arms through a fresh CLI process without reselecting siblings. | Existing recovery reference; selected-only extension remains future acceptance. |

## Approved test boundary and bounded acceptance

The primary seam is the built public CLI with real temporary Git repositories and independent Git expectations. Existing create fixtures, structural/freeze/recovery controls and the PTY driver supply the prior art. The real stdio SDK boundary supplies one final installed-package delivery smoke. No new private testing seam, prompt stub or engine mock is planned.

The canonical specification enumerates T1–T14: established defaults, terminal subset/default/cancellation, literal repeated selection, invalid input, chosen-parent/departure behavior, independent protected arms, mandatory descendants, existing input/history semantics, menu-time changes, genuine conflict, paused/legacy scope, public command routes and the installed MCP delivery check. These refine the owner-approved six behavioral groups; they do not demand every combination of flags, branches, paths and failures.

Acceptance remains future work on the implemented immutable candidate. Preserve baseline evidence independently; do not count source tests, measured Graphite behavior or earlier absorb acceptance as passing tests for the new selector. One implementation PR and cheap CI remain the delivery policy; full repository/full paid CI and native asset matrices are excluded.

## Verification record

The adjacent [basis record](../verification/evidence/create-insert-child-selection-spec-2026-10-29/basis.json) identifies the baseline, artifact hashes, source confirmation, approved boundary and new-versus-measured claims. The [manifest](../verification/evidence/create-insert-child-selection-spec-2026-10-29/manifest.json) hashes the specification, this note and the basis record from the repository root. Local verification checks headings, sequential stories, required contract/test cases, existing evidence hashes, source-reference reachability through the pushed baseline and local links. It does not execute a new feature or start CI.
