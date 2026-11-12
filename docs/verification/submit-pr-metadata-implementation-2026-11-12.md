# Explicit submit metadata: implementation acceptance

Candidate for #178 and #179–#181, based on stable 0.7.1 source `9266758658ffcc3936fe2c8f9125709ce85271dd`. This record does not claim that published npm 0.7.1 includes the change.

## Behavior

Submit accepts an explicit title and UTF-8 body file for its starting branch, including metadata-only updates. Creation uses approved text immediately. Omitted fields retain current GitHub values; managed footers remain under normal reconciliation. Captured file input survives confirmation without rereading. Invalid inputs, ineligible targets and changed identities retain early refusal and existing guards.

Partial metadata failures disclose the unconfirmed target and already-pushed code. An unchanged caller retry discovers existing PRs and finishes metadata/footer work without duplicate creation. Existing selection, hooks, roles, draft authority and external approval requirements remain unchanged.

## Boundary and results

The primary seam is public CLI processes with real temporary Git repositories and bare remotes, controlling only gh responses/writes. The same six-file selection covers 26 title/body scenarios, six combined confirmation/retry/MCP journeys and existing ancestor/footer/local-input controls. **All 54 cases pass on Node and all 54 pass on native**, with no pending cases. Those are repeated observations of the same scenarios, not 108 unique workflows.

The isolated installed npm gate passes offline installation, both executable names, completion, curated contents and **29 selected cases**, followed by the existing one-case alias control. Two existing legacy-producer cases are pending because their separate released producer was not supplied. Six selected metadata cases cover creation/update, partial-failure retry, literal arguments through the existing SDK MCP client and protected refusal. This gate does not certify a live GitHub publication or a released npm version.

Typecheck, focused ESLint, formatting, workflow syntax and whitespace checks pass. Node 24.19.0 and Bun 1.3.14 were used. The full CI matrix was not started.

## Source and artifacts

The Git index tree before adding this acceptance record and its receipts is `66fd5c7400370f78b5164a1c777196e426e5ab9b`. It contains the exact executable/test/configuration inputs used above; [code input hashes](submit-pr-metadata-implementation-evidence-2026-11-12/code-inputs.sha256) bind their bytes independently of the later documentation commit. No runtime code changed between those campaigns and their original artifact build. The review correction below has a separately rebuilt final artifact and focused acceptance.

- Original candidate native executable SHA-256: `0428bed29a598b02859ab2986a2697af80eba62aa17ab81320a1889c763cfaa6`.
- Original candidate npm tarball SHA-256: `49655daa23ecf59fe5ec2225ff028de5733d4121c5f651ac55a999338b50ee83`.

[Retained receipts](submit-pr-metadata-implementation-evidence-2026-11-12/) preserve the original red tracer, exact Node/native reports and installed gate output. `SHA256SUMS` verifies those unchanged copied receipts. The red tracer demonstrated missing explicit-metadata failure disclosure before the diagnostic change. Two intermediate expectations were corrected to the existing contracts: declining confirmation exits 1, and MCP reports a protected CLI refusal as `cli_error`. No production behavior was changed to satisfy those expectations. An initial npm build was refused by sandbox access to the host cache; the unchanged build passed with a disposable cache.

The [approved specification](../specs/submit-pr-metadata.md) and [version-pinned baseline](submit-pr-metadata-spec-2026-11-12.md) retain their original boundaries. Independent final reviews and ordinary CI disposition belong to PR #182 after integration. No user project, active installation, live fixture or release is changed by this acceptance.

## Independent review correction

The standards review reported no findings. The specification review found that a grouped short edit flag followed by `--no-edit` could bypass the required explicit-metadata conflict: `-se` was not recognized after yargs negation erased `edit`. Public CLI red tracers reproduced unintended publication for both title-only and body-only input. The raw flag check now recognizes edit after boolean short aliases while preserving long option values and the `--` separator boundary. No general parser refactor was introduced.

Final focused acceptance passes **four cases on Node, four on rebuilt native, and five on the rebuilt isolated npm installation**. These include both grouped-edit pre-publication refusals, the existing literal flag-looking title, and literal creation/metadata-only updating. Typecheck, targeted lint and formatting pass. The earlier full 54-case campaigns and 29-case package gate ran on the original candidate; they were not repeated or claimed against these new bytes.

- Final native executable SHA-256: `c8a2942570acaa311a156ed03c6a728cd90ea6e2dedde9e08e3a3b56f35f2683`.
- Final npm tarball SHA-256: `0637ff1c21c8ef28a426556cca452b24914dd4118ef95d057b11924654f3a488`.
- Git input tree before this review receipt/document update: `014d585cbee2f8d7cad5441136e45e7f3048b76c`.
- [Final changed input hashes](submit-pr-metadata-implementation-evidence-2026-11-12/grouped-code-inputs.sha256).

The retained `grouped-*` reports identify this focused correction. The original red report also contains a rejected exploratory reviewer shorthand (`-ralice`), which the existing parser treats as unknown options; that invalid control was removed, rather than changing production parsing to accept it. The two valid grouped-edit red failures remain preserved unchanged. No full CI matrix, live fixture writes, releases or active installation changes were made.
