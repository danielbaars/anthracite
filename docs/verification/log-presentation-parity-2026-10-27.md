# Single-trunk log presentation verification

Specification: [#7](https://github.com/danielbaars/anthracite/issues/7), implemented together with #8, #9 and #10 in one PR. Reference: retained Graphite 1.8.6 captures under [the specification evidence](evidence/log-presentation-parity-2026-10-27/).

## Visible changes

The canonical fixture previously started with the independent maintenance stack and gave the feature stack an additional graph column. Ordinary full and short views now use the retained reference sequence, including a separate empty tip and Unicode branch. Reverse retains its own reference direction and sibling order. This is a bounded presentation rule; it does not change engine traversal or claim universal Graphite collation.

```diff
-◯        maintenance
-│ ◯      api-followup (needs restack)
-│ ◯      api
+◯      api-followup (needs restack)
+◯      api
+│ ◯    feature/café-long-branch-name-for-terminal-width
```

Worktree context also preserves existing status:

```text
◯ api (frozen) (API café workspace)
◯ api-followup (needs restack) (followup workspace)
```

Full commit text is dim, branch headers have no surplus spaces, and long output no longer adds a terminal LF. Known long display flags are accepted and ignored across the five routes; unknown flags still fail. Help and completion describe the supported grammar, with each short help alias listed once.

## Final verification

The tested source commit is `4cffdf27b2c0fcbb8567f6d469472611a615fef2`: Node 24.19.0 and a separately compiled Bun 1.3.14 native candidate. Each runtime passed the same nine selected files (83 tests) plus one real conflict/recovery control: **84 passing, zero failed, zero pending per runtime**. The thirteen new scenarios reuse existing public fixtures; the remaining checks are existing regressions. Forced workspace build, uncached source lint, workspace typecheck, changed-test lint and formatting passed.

Both review axes have zero open findings. Integrated checking caught and corrected a logger return-type lint issue, a missing explicit large-payload assertion and an ordinary-completion regression before this final pass. The final large-delivery case asserts the complete 96KiB subject, ancestry tail and raw final byte on both runtimes.

[Acceptance results and source/native identity](evidence/log-presentation-implementation-2026-10-27/acceptance.json) retain per-file counts and timings, conflict-control results, the source tree and binary SHA-256. [Raw worktree/style examples](evidence/log-presentation-implementation-2026-10-27/worktree-examples.json) preserve observed stdout, header rows and ANSI data from the ticket verification unchanged; the final suite repeats those assertions. [The manifest](evidence/log-presentation-implementation-2026-10-27/manifest.json) records their sizes and hashes.

## Acceptance coverage

The public built CLI is the test seam. Tests use actual temporary Git repositories and linked worktrees; PTY is a transport for that same CLI. Literal expected graphs come from the declared fixture and retained reference, rather than the candidate renderer.

| Spec groups | Evidence |
| --- | --- |
| 1–4 | Six `log_graph_presentation_cli` scenarios: linear aliases, ordinary graph, reverse graph, tip/current variation, equal dates/retracking, classic/real selector. |
| 5–6 | Existing positive-depth, selected-stack and zero-depth full/short/options/state regressions. |
| 7–9, header portion of 10 | Worktree presentation CLI scenarios. |
| Long portion of 10, 11–13 | Long presentation CLI scenarios, affected classic/long compatibility controls and pager transport. |
| 14 | Pinned Anthracite classic order, real Unicode selector and existing conflict/recovery controls. |

## Deliberate limits

Classic preserves Anthracite's historical order because its metadata cannot reconstruct Graphite's historical tracker registration sequence. Ordinary full/short multi-trunk selection, PR-service badges, general Unicode wrapping and basename disambiguation remain outside this round. The resolved zero-depth behavior takes precedence over Graphite's dangling hidden-descendant connectors. A simple linear stack may look largely unchanged.

This report records local acceptance. Remote verification uses only the existing cheap automatic PR workflow. The complete manual CI matrix, release assets, release publication and global installation were not run.
