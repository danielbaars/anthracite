# Targeted insertion delivery provenance

Final source was frozen before integrated acceptance. `freeze.json` pins base,
source manifest, emitted manifest and host-native executable. The complete source
and emitted candidates, host executable and npm tarball are retained here outside
the author worktree. Later repository proof documents do not change that source.

`red-help.json` is a genuine public help gap: original help did not explain the
terminal menu default. The original complete red runtime was not archived or
hashed at execution; do not imply otherwise. `red-completion-corrected.json`
is a genuine public completion gap using the original completion source with the
corrected public invocation. Its relevant source/emitted/test hashes are recorded
in `red-completion-corrected.sha256`; it is not a complete original runtime archive.
The final complete runtime/source archives are retained separately.

`red-completion.json` and the one failure in `green-routes.json` used a fixture
that appended --no-interactive after the completion word, so they did not send
completion's documented final-word protocol correctly. They are harness mistakes,
not product regressions or successful acceptance. `completion-corrected.json`
confirms the corrected invocation after restoring the new completion behavior.
The final four route cases execute unchanged on both frozen runtimes.

The first attempted supplemental controls launch failed before starting Mocha
because output directories did not exist. No test ran in those attempts. The
recorded final controls reports are the subsequent actual executions.

Historical ticket-50/51/52 reports describe development candidates and are not
added to final ticket-53 counts. Earlier fixture-navigation/protection mistakes
and the earliest ticket-50 artifact-hash gap retain the qualifications recorded
in their handoffs. Pinned Graphite/Anthracite parity research describes baseline
observations and source findings, not newly passing implementation checks.

The final isolated npm test was deliberately run outside the sandbox from the
outset so the existing numeric-zero cancellation control could observe its own
process with ps. It installed offline with ignore-scripts into a disposable
prefix and isolated HOME/npm configuration. The existing script removed that
prefix afterward. User installation, credentials and client configuration were
not changed. Exactly one new T14 session was executed against the final tarball;
its SDK wire messages and the enclosing installed log are retained. Six other
selected package checks are existing controls, including absorb and numeric-zero
cancellation; they are not six extra targeted-insert T14 cases.

No full repository suite, full CI matrix, platform release-asset matrix, benchmark,
Graphite binary, live GitHub action, publication, release, global user installation
or MCP client-configuration change was part of this acceptance. Only the existing
cheap npm-test caller selection was extended; no workflow file changed.
