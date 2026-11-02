# Landing plan presentation: bounded comparison and verification

Date: 2026-11-02. Implementation status: local unreleased candidate after npm 0.6.2.

## What was actually observed in Graphite

The installed Graphite 1.8.6 executable was run through REA process capture in a separate synthetic repository. Its executable SHA256 is retained in each capture. No native analysis session or engine installation was needed.

| Input boundary | Actual output | What this establishes |
| --- | --- | --- |
| Existing synthetic tip, locally tracked without a PR association; normal local `get` did not establish an association in this probe | `ERROR: The following branches do not have associated PRs`, the branch name and `Please submit and then retry.` | A short, concrete blocker plus a next action in this observed case. |
| Three locally created branches and explicitly fictitious cached open PR records | `ERROR: Cannot determine if stack is ready to merge` | The real CLI still lacked mergeability evidence. This was not a successful Graphite plan or a live PR/merge test. |

The captures are [missing association](evidence/land-presentation-2026-11-02/graphite-merge-capture.json) and [controlled cache](evidence/land-presentation-2026-11-02/graphite-merge-controlled-capture.json). Readable terminal extracts are retained beside them. The latter cache explicitly labels its PRs synthetic; no corresponding remote PRs were created. REA evidence IDs, provider, terminal shape, executable identity, timing, truncation and residual unknowns remain in the unchanged JSON records. Network activity was not observed by these captures; filesystem observation was not requested. Graphite may maintain its own local cache/onboarding files and launch background processes.

**Unresolved:** the successful Graphite merge-plan layout, its dirty-worktree presentation, and its policy/landing semantics were not established. This repair does not claim byte parity with that unknown layout. It applies the observed concise blocker/next-action pattern and our own explicit scope requirements without pretending the proposed output came from Graphite.

## Anthracite before and after

A real temporary Git repository and local bare remote were used for both the released npm 0.6.2 CLI and the source candidate with the same three-PR fixture and controlled GitHub responses. Both previews preserved local persistence and remote refs. The released output contained 20 logical lines, including full commit IDs and repeated implementation details. The candidate contained 16 logical lines, with PR order, maintenance and cleanup; that count describes this fixture only.

- [Released 0.6.2 output](evidence/land-presentation-2026-11-02/anthracite-before.txt)
- [Candidate output](evidence/land-presentation-2026-11-02/anthracite-after.txt)
- [Candidate with local work](evidence/land-presentation-2026-11-02/anthracite-blocked-after.txt)

The candidate puts blockers and dirty-state guidance first, retains ordered branch names/PR numbers, identifies existing published pushes and PR base/footer updates, and identifies work that remains unpublished. Existing technical details move to `--debug`. Confirmed-merge-only local/remote cleanup remains explicit. Existing pending recovery presentation remains detailed and unchanged.

## Verification and delivery boundary

The first blocker-first public CLI regression failed against the original renderer and passed after the repair. Four presentation cases plus three retained preview cases pass on Node 24.19.0 and a macOS ARM64 Bun 1.3.14 native candidate: seven per runtime, 14 final passes. Cases cover dirty-state preservation and guidance, full ordered scope without hashes, debug details, fanout/unpublished scope, existing exact-prefix preservation, verified merged cleanup and readiness blockers. Build, typecheck, changed-source lint, formatting and whitespace checks pass.

See [retained results](evidence/land-presentation-2026-11-02/results.json). The repair changes fresh-plan rendering and help only. It changes no selection, policy, confirmation, merge, push, cleanup or recovery behavior. No application checkout, active Anthracite installation, shell completion or MCP registration was changed; no CI/full matrix or GitHub PR mutation was requested. The comparison and evidence can be published on a documentation-only branch independently of the still-local implementation.
