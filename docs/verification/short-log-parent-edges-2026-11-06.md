# Short-log parent edges (#145)

Baseline: `241868f492ec0fb183306562b4344f87fa1186d4` (public npm 0.6.12).
This record describes an unreleased source candidate, not a published package update.

## Observed change

For `main → child → tip`, all five short-log routes now print:

```text
◉  tip
│
◯  child
│
◯  main
```

The first public-CLI regression failed on the baseline with exactly the two
missing stem lines, then passed after the change. Reverse output connects the
same visible relationships. Bounded depth stops at visible branches, and zero
depth remains a single row.

Only consecutive actual parent/child rows in the same graph column receive an
extra stem. Fork rows and branch order remain unchanged. Linear portions within
parallel arms also receive stems, deliberately extending the retained Graphite
1.8.6 presentation reference. Full, long and classic rendering are unchanged.

The option is enabled only by `logAction`. The shared branch selector and
conflict-status callers retain branch-only output. Tests select an exact branch
through a real terminal and resolve/continue a real restack conflict.

## Acceptance

The focused public-CLI campaign uses real temporary Git repositories:

- `log_short_edges_cli`: seven new cases covering aliases, reverse, bounded and
  zero depth, trunk, fanout, interactive selection and conflict continuation.
- `log_graph_presentation_cli`: six existing cases retain fork columns, ordering,
  Unicode names, classic output and selector values; expected short output adds
  only the intended stems.
- `log_steps_short_cli`: existing short-depth and alias controls.
- `log_worktree_presentation_cli`: existing worktree labels, frozen/stale status,
  color and full-header controls.

| Delivery                                                         | Result                                    |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Node 24.19.0                                                     | 33 passing across the four focused suites |
| Native macOS ARM64, Bun 1.3.14                                   | The same 33 passing                       |
| Isolated offline npm candidate installation                      | All seven new cases passing               |
| Build/lint, typecheck, changed-test lint, formatting, actionlint | Passing                                   |

The npm candidate keeps the source manifest's 0.6.12 version for local testing;
it is not the public 0.6.12 tarball and was neither published nor installed into
the user's active CLI location.

The new suite is included in ordinary CI's existing single Node job. The full
matrix, live GitHub writes, publication and active installation changes are not
part of this work.
