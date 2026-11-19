# Landing replay preflight: specification evidence

## Status and approved boundary

Specification prepared on 19 November 2026 for [#204](https://github.com/danielbaars/anthracite/issues/204), after explicit approval of its scope and public-process test boundary. The [canonical specification](../specs/land-replay-preflight.md) is a proposal; this document claims no implementation acceptance.

Approved scope: new landings simulate the selected chain and mandatory survivors against current remote trunk before the first merge; commit-level fidelity, isolated preserving execution, bounded refusal, conflict paths and revalidation after confirmation. Existing pending landing behavior, the #205 correction, publication schedules and all per-effect protections remain authoritative.

Approved seam: public CLI subprocesses, real temporary Git repositories and bare remotes, controlled GitHub responses at the existing `gh` boundary. Implementation acceptance includes targeted Node/native runs, isolated installed-npm cases and one existing MCP-client smoke. No private simulator test interface, live GitHub fixture or user-project mutation. No CI or full matrix during specification; one implementation PR remains the intended delivery scope.

## Retained observation, not a new specification-time test

The [original issue report](evidence/land-replay-preflight-spec-2026-11-19/original-issue.json) is retained before replacement. The earlier paired #204/#205 investigation used the publicly released npm **0.9.2** executable in an isolated installation. Its [unchanged probe](evidence/land-replay-preflight-spec-2026-11-19/probe.cjs), [raw result](evidence/land-replay-preflight-spec-2026-11-19/results.json) and [summary output](evidence/land-replay-preflight-spec-2026-11-19/probe.log) are retained with [artifact and observation metadata](evidence/land-replay-preflight-spec-2026-11-19/provenance.json) and [SHA256 checksums](evidence/land-replay-preflight-spec-2026-11-19/SHA256SUMS). The archived script contains the original temporary fixture-module location; it is an observation artifact, not a portable new test runner.

The fixture starts with `main → base → child → tip`. An independent commit adds a conflicting `child.txt` to bare-remote main without fetching or advancing local main. The `gh` fixture reports supported rebase-only policy and clean PR readiness, while actual Git rewrites, refs, pushes and conflict handling run against the local bare remote.

Observed outcomes:

1. Local and remote trunk OIDs differ before inspection.
2. `land tip --dry-run` exits **0**, reports ready for the next merge and preserves the project snapshot.
3. `land tip --yes --wait-timeout 0` exits **1** after the first PR is confirmed merged; actual Git replay conflicts in `child.txt`. The remaining two PRs are open.
4. Resolving the file and running `continue` exits **0**.
5. In that historical 0.9.2 run, pending dry-run exits **1** with the #205 mandatory-push message; actual resumption nevertheless exits **0** and completes all three PRs. That reporting defect is distinct from the missing initial replay check.

These are synthetic controlled GitHub observations, not live GitHub merge acceptance. Conflict reproduction uses real Git. No private user-project content, tokens or real PR bodies are retained. Temporary fixture paths and OIDs belong to the original synthetic run. The downloaded npm tarball is identified by digest rather than copied into documentation.

## Source boundary

The specification is based on main/released **0.9.3**, commit `8a61577eda254518842f09155cfa3a3548860b52`. Source inspection shows:

- Fresh landing planning already snapshots remote trunk, checks ancestry and inspects participants, policy and PR readiness.
- Missing objects for ancestry inspection already have a disposable-repository pattern.
- The plan is rechecked after confirmation and under the landing lock.
- Actual survivor replay follows a confirmed merge, including necessary reparenting and descendants; no complete prospective replay gate precedes the first request.
- The 0.9.3 #205 correction classifies owned pending publication consistently; it does not introduce replay simulation.

The runtime evidence remains pinned to 0.9.2. This source assessment does not relabel it as a new 0.9.3 execution. Relevant prior art is the fresh landing planner, isolated ancestry inspector, survivor replay/continuation, public deferred delivery/plans tests, push observers and the existing MCP client.

## Publication and specification checks

Preserve the original issue body in the evidence directory before publishing the complete English specification to #204. Apply `ready-for-agent` and link the pushed canonical document and this evidence record using immutable GitHub commit URLs. Do not create tickets or an implementation PR in this step.

Check required to-spec sections and story numbering, local links, unchanged source evidence/checksums, replay/publication scope and documentation-only Git changes. No product code, package version, active installation, user project, CI workflow or full matrix changes are part of this specification.
