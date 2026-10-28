# Submit role review corrections

## Review and outcome

The [follow-up review](https://github.com/danielbaars/anthracite/pull/34#issuecomment-6470226186) identified three valid corrections in PR #34. They were addressed at `0fa3f144bf2cf13e34b3a4f4920f8977cdf2c1b4` without changing the feature scope or creating another PR.

| Finding                                                 | Correction                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account lookup escaped through a raw process/JSON error | Capture `gh` stderr and convert failures to an actionable `an auth` message; distinguish an absent executable with installation guidance. Test the exact message rather than accepting the fixture's forwarded stderr. |
| Role subprocess stderr bypassed formatted errors        | Capture reviewer/assignee read and write diagnostics, preserving the diagnostic inside the contextual error and the existing partial-progress/readback behavior. Keep ordinary Git push output intact.                 |
| Help overstated unchanged submission behavior           | Describe unchanged submission scope. A selected PR with no remaining action may still become a no-op. Update help and agent guidance consistently.                                                                     |
| Push wrapping lost a signalled abort's classification   | Rethrow `CommandKilledError` so the existing cancellation handler retains its silent nonzero outcome. An external Git shim signals only its own owned push process and verifies that no PR writes follow.              |

The adapter observation was not a requested refactor. Reviewer and assignee implementations remain separate because their confirmation semantics differ. The unrelated fixture create-reviewer compatibility branch was retained.

## Verification

Seven exact process/error regressions fail against the original native candidate, including both readback paths, partial writes, signalled push, authentication and an absent `gh`. They pass on the corrected implementation. The synthetic readback shim was corrected before the retained baseline was captured; no invalid-shim failure is presented as evidence of a product defect.

The same focused public-CLI acceptance selection, extended with four new cases, passes **73/73 on Node and 73/73 on native**, with zero pending tests and zero failures. The build, explicit no-emit typecheck and uncached production-source lint pass. Native execution uses an independently compiled Bun 1.3.14 binary with SHA-256 `0bc78cf6ab6f1f97c47e33266705cc1ff5b616561e71d3cc73a8dbfb4ef4494d`.

The added cases check installation guidance without a `gh` executable, separately captured reviewer and assignee readback failures, and a real signal on the owned push subprocess. Existing cases now pin authentication guidance, malformed identity JSON and controlled diagnostics after nonzero partial writes. Help assertions use the corrected scope description. Tests use the previously approved public CLI/real Git/controlled GitHub seam; no internal handler mock or production-only test hook was added.

- [Original review text](evidence/submit-pr-roles-review-fixes-2026-10-28/review-comment.md)
- [Red baseline](evidence/submit-pr-roles-review-fixes-2026-10-28/red-baseline-final.json)
- [Final per-runtime summary](evidence/submit-pr-roles-review-fixes-2026-10-28/summary.json)
- [Candidate trees and byte-verified evidence manifest](evidence/submit-pr-roles-review-fixes-2026-10-28/manifest.json)

All retained reports and compiler logs were copied unchanged and byte-verified. The original [implementation verification](submit-pr-roles-implementation-2026-10-28.md) describes the earlier candidate and remains useful provenance; the results above cover these subsequent corrections. No live review requests, full CI matrix, release or global installation were performed. Only the existing inexpensive CI is allowed on the update to PR #34.
