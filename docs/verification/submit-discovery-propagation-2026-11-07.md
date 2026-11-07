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
form the focused compatibility campaign. The new file joins ordinary CI's
existing Node smoke selection. Full CI, live GitHub writes, npm publication and
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
checks passed. No unresolved test failures remain; no Actions run was started.
