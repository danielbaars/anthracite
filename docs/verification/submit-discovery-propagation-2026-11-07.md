# Submit discovery propagation (#149)

Baseline: `21ecfcc6d0877b2d9c4c45eb43fa3218ef55ca4c` (public npm 0.6.13).
This is local candidate acceptance, not a publication or live GitHub API-lag measurement.

The baseline reproduction used public npm 0.6.13, real temporary repositories
and bare remotes, and controlled external `gh` responses. Both stale-list and
stale-detail cases failed after a successful push, before footer work. An
unchanged retry repaired a genuinely stale footer. The first committed CLI
regression reproduced the same error before the implementation changed.

The candidate keeps stable identity validation and complete/unique discovery,
while taking selected PR details from a validated known-number read. A mutable
list/detail disagreement refreshes details. Local branch leases are checked
after the extra reads. Pinned review/landing selection retains its existing mode.

For an existing-PR update, a fresh remote-head check and expected pushed SHA
bound the visibility wait after discovery: at most two additional detail reads,
with 250 ms before each. No push or PR effect is retried. Unresolved visibility
retains the pushed code and reports remaining work without claiming an outside
actor. Remote head uncertainty, closed PRs and identity failures still refuse.

Nine new public-CLI cases cover list lag; detail lag; both snapshots lagging;
bounded persistent lag plus unchanged retry; a real external remote ref change;
a closed target; invalid identity during retry; protected sync reconciliation;
and successful sync with matching heads. The discovery suite additionally
checks fresh detail output during list state/head lag without repository writes.

Existing reused-name, submit-input, body/footer and pinned-review regressions
form the focused compatibility campaign. Ordinary CI separately selects the two core
propagation cases; the complete file remains in focused local and manual full validation. Full CI, live GitHub writes, npm publication and
active installation changes are outside this task.

## Results

All 77 selected scenarios were verified on Node 24.19.0 and a Bun 1.3.14 native
macOS ARM64 executable. The seven-file campaign passed 76 cases per runtime;
one existing network-failure fixture was initially triggered by the new
creation-confirmation detail read. Its outage now starts after successful draft
status readback, preserving its intended post-confirmation footer-failure
scenario. That corrected case passed separately on both runtimes. The simplified
missing-discovery case was also rerun on both runtimes.

All nine new workflow cases passed through an isolated, offline installation of
the generated npm candidate. The candidate retains the source manifest's
0.6.13 version for testing; it is not the public npm 0.6.13 artifact.

Build/lint, typecheck, changed-test lint, formatting, actionlint and whitespace
checks passed. These checks preceded PR publication and did not start Actions.

## Ordinary CI follow-up

The first [ordinary CI run](https://github.com/danielbaars/anthracite/actions/runs/42394054341)
passed build/typecheck and CLI smoke selection, but its broader installed-package
campaign exposed an incomplete sync fixture: PR #3 appeared in discovery without
a usable detail response. The fixture now supplies both snapshots and resolves
explicit numeric PR-reference overrides to their declared branch. The production
CLI is unchanged by this follow-up. All ten sync reused-identity cases pass on
Node and native, including the installed gate's previously failing scenario.

Ordinary CI selects the two core list/detail propagation cases separately from
the general file smoke selection. The complete nine-case file remains available
to local/full validation. The single job's existing ten-minute cap and manual-only
full matrix are unchanged.

The exact existing `scripts/test-npm-package.cjs` gate passed locally with the
corrected fixture: 23 installed-artifact scenarios plus the `anthracite` alias
landing case, including real Git/MCP operation and cancellation. The published
0.6.11 legacy producer remained enabled. Both selected ordinary-CI propagation
cases passed locally. Typecheck, changed-fixture lint, formatting and actionlint
also passed before the follow-up was pushed.
