# Standards review

Reviewed `5f76186bcfd2ee0952b9cb48bab1ddf94f00c3c5...c842b14df7c96c9eaa99b305e0eafc62e6ab5d7a`, including the complete commit list, against `AGENTS.md`, `CONTRIBUTING.md`, `docs/installation.md` and the twelve Fowler smell heuristics.

**Findings: 0 documented-standard breaches; 0 actionable baseline smells.**

The new graph selection, maintenance, checkout and recovery responsibilities have bounded modules and reuse the existing engine/replay/continuation boundaries. Shared engine options retain existing caller defaults. The optional get record and retained legacy marker avoid a global recovery-format migration; compatibility and finish-before-downgrade limits are explicit. Existing tests that depended on the former defaults become explicit compatibility controls rather than disappearing. Public CLI/MCP tests observe real Git state, with controlled GitHub responses at the external boundary.

New source, guidance and commit messages are English; inherited attribution and license files are preserved. No new dependencies, release/version changes or unrelated tooling are introduced. The additional npm acceptance uses the existing isolated offline gate. Source-qualified receipts distinguish failed initial acceptance, focused repairs and unchanged controls without claiming one final full-suite pass.

The user’s explicit prohibition on CI/full-matrix execution supersedes the general manual-validation instruction in `CONTRIBUTING.md`; their absence is not a standards finding.

This is a read-only static Standards review, not a separate functional acceptance or Spec verdict. No tests, workflows, live service mutations or source edits were performed.
