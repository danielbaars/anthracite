## Problem Statement

Anthracite users switching between `an log` and Graphite still see differences in branch ordering, graph columns, worktree context, terminal styling and accepted long-log options. Fixing zero-depth inspection in #1 did not address those presentation differences. The owner reasonably expected a more complete visible result and wants the remaining daily-use display work completed in one focused implementation round.

The current comparison targets Graphite 1.8.6 and Anthracite source commit `59ce4bdc74e9cdeed8a0eebe51229ac257379563`, installed locally as `0.1.1-dev.20261027133955`. A fresh paired fixture confirms that Anthracite puts the independent maintenance stack above the main feature stack and consequently uses additional graph columns; it omits another worktree's name, uses gray rather than dim commit text, leaves branch-header trailing spaces, and rejects display flags accepted by Graphite's long mode. Long output also adds one final LF that the reference output does not contain. Log help repeats some short aliases and misdescribes untracked-branch output as interactive selection.

These are finite, demonstrated gaps. The basic appearance of a simple linear stack already largely agrees. This issue does not promise a completely different log design or complete Graphite CLI parity.

## Solution

Complete the remaining bounded, single-trunk presentation work in one implementation PR:

| Area                           | Required user-visible result                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full, short and reverse graphs | Display the same selected branches, sibling sequence, connectors and graph columns as the retained Graphite reference cases.                                          |
| Worktree context               | Add another worktree's basename to the branch checked out there, including when the caller itself is in a linked worktree.                                            |
| Presentation polish            | Use dim commit text in color-enabled full output, remove unnecessary branch-header trailing spaces, and remove the additional terminal LF from non-paged long output. |
| Long-mode compatibility        | Accept and ignore the documented log display options on long routes while retaining unknown-option errors.                                                            |
| Help and completion            | Show each supported short alias once, describe untracked output accurately, and expose the long route's newly accepted options.                                       |

Keep Anthracite's names, legacy aliases, pager settings, zero-depth correction, branch information and protection behavior. Preserve classic's existing Anthracite traversal order as an explicit exception: the follow-up Graphite experiment shows classic ordering depends on historical tracker registration order, which Anthracite's current stored branch metadata does not record. Reproducing that history is outside this presentation-only round. Classic must continue to work and ignore the existing display selectors; it is not silently made to use the ordinary renderer's new ordering.

Completion means these five areas satisfy the named reference cases, local Node/native verification passes, and the one implementation PR is reviewable with concise before/after examples. A successful result is daily log presentation parity for the documented single-trunk cases, with the explicit exceptions below.

The owner approved the five-area round and approximately 10–15 focused comparison scenarios on 27 October 2026. That approval establishes the existing public-CLI test boundary; no additional private testing seam or ticket series is required. The newly measured classic-order exception is recorded explicitly here rather than being hidden behind a claim of complete visual parity.

## User Stories

1. As an Anthracite user, I want ordinary full logs to present independent stacks in the reference order, so that switching from Graphite does not move the main stack into unexpected columns.
2. As an Anthracite user, I want short logs to use the reference branch sequence and compact graph columns, so that compact inspection remains easy to follow.
3. As an Anthracite user, I want reverse logs to retain the reference sibling order while reversing graph direction, so that reversing the view does not arbitrarily reorder independent stacks.
4. As an Anthracite user, I want connectors to describe only the branches actually displayed, so that depth-limited output does not imply hidden graph nodes.
5. As an Anthracite user, I want `--stack` to keep its existing ancestor/descendant selection, so that a presentation change does not broaden my inspection.
6. As an Anthracite user, I want positive depth limits to retain their existing meaning, so that established inspection commands remain reliable.
7. As an Anthracite user, I want `--steps 0` to continue showing only the current tracked branch, so that presentation work cannot reintroduce the resolved selection bug.
8. As an Anthracite user, I want the `l` and `ls` aliases and existing nested short forms to retain their canonical meanings, so that aliases do not produce a different graph.
9. As an Anthracite user, I want an empty tracked tip to retain its branch identity, so that sharing its parent's commit does not hide it.
10. As an Anthracite user, I want Unicode and long branch names to remain readable, so that the new layout does not depend on short ASCII names.
11. As an Anthracite user, I want branches checked out in other worktrees to show those worktree names, so that I can locate where a branch is in use.
12. As an Anthracite user, I want worktree context in both full and short output, so that using compact output does not hide that information.
13. As an Anthracite user, I want worktree labels to coexist with frozen and needs-restack indications, so that location information does not replace meaningful status.
14. As an Anthracite user, I want the current worktree's branch to remain marked current without a redundant own-worktree label, so that the current location is unambiguous.
15. As an Anthracite user invoking the CLI from a linked worktree, I want another checked-out branch to identify the main worktree when applicable, so that worktree context is relative to where I run the command.
16. As an Anthracite user, I want worktree names containing spaces or Unicode to be treated as labels, so that display text cannot be mistaken for a different branch identity.
17. As an Anthracite user, I want commit text to use the reference dim styling when color is enabled, so that the visual hierarchy matches the intended graph presentation.
18. As an Anthracite user, I want color-disabled output to remain plain text, so that pipes and terminals without color remain usable.
19. As an Anthracite user, I want branch headers without unnecessary trailing spaces, so that copied output and comparisons are clean.
20. As an Anthracite user, I want long output without the additional final LF, so that the retained reference's output boundary is respected.
21. As an Anthracite user, I want `log long` to accept the known display options and ignore their scope, so that Graphite-compatible invocations do not fail unnecessarily.
22. As an Anthracite user, I want `ll` and nested long forms to accept the same options, so that compatibility does not depend on spelling the canonical command.
23. As an Anthracite user, I want an invented long option to remain an error, so that compatibility does not make typos silently succeed.
24. As an Anthracite user, I want global cwd, interaction, quiet and debug behavior to retain its existing meaning, so that display-option acceptance does not override global policy.
25. As an Anthracite user, I want short aliases listed once in help, so that the supported option grammar is clear.
26. As an Anthracite user, I want show-untracked help to describe its separate output section, so that I understand the functionality that already works.
27. As an Anthracite user, I want long help and public completion queries to describe the newly accepted options, so that discoverability agrees with parsing.
28. As an Anthracite user, I want classic to retain its legacy traversal and selector behavior, so that this round does not invent missing registration history or change a compatibility mode unexpectedly.
29. As an Anthracite user, I want existing current, frozen and stale labels to remain accurate, so that visual changes do not conceal branch state.
30. As an Anthracite user, I want inspecting logs to preserve branches and local work, so that a display improvement cannot rewrite my stack.
31. As an Anthracite user, I want interactive branch selection to keep returning actual branch names, so that worktree annotations cannot become checkout or move targets.
32. As an Anthracite user, I want conflict-status output and ordinary branch information to retain their existing contracts, so that shared formatting code does not change unrelated commands.
33. As a maintainer, I want the same named public scenarios to pass on Node and the native CLI, so that the locally installed binary agrees with development behavior.
34. As a maintainer, I want a bounded set of reference comparisons and one implementation PR, so that the work delivers a visible result without another large specification and ticket program.
35. As a repository owner, I want only the existing cheap automatic CI during this round, so that verification does not restart the expensive full matrix.
36. As a maintainer, I want unknown behavior and deliberate compatibility exceptions reported explicitly, so that a narrow success is not described as complete Graphite parity.

## Implementation Decisions

1. **Pinned reference and finite scope.** Use the installed Graphite 1.8.6 identity and retained paired captures as the behavioral oracle. Compare equivalent synthetic Git graphs with separately initialized trackers and independently established parent relationships. Branding and each fixture's actual worktree basename are expected differences. Do not copy real authentication or contact a PR service.
2. **Display-local ordering.** Change the ordinary full/short stack presentation and its reverse form without changing the engine's general child ordering, branch topology or mutation/navigation policy. On the canonical fixture, ordinary branch rows are `api-followup`, `api`, the Unicode feature branch, `empty-tip`, `ui`, `search`, `base`, `maintenance`, `main`. Reverse branch rows are `main`, `base`, `api`, `api-followup`, `search`, the Unicode feature branch, `ui`, `empty-tip`, `maintenance`. Full and short use the same underlying branch selection. These reference sequences and retained graph transcripts are the acceptance contract; they are not proof of a universal Graphite sorting algorithm. Resolve the smallest deterministic display rule satisfying the bounded ordering controls before implementation of unrelated polish. If new evidence contradicts that rule, report the gap rather than introducing a tracking-history model or silently widening the investigation.
3. **Classic is an explicit exception.** The same Graphite graph and parent mappings can produce a different classic sequence after retracking siblings in a different order, while ordinary short output stays identical. Anthracite stores parent revision, parent name, frozen state and PR metadata, without historical sibling registration order. Preserve current Anthracite classic ordering and its selector-ignoring behavior. Do not add persistence, migrate existing stacks or claim exact historical classic-order parity. The ordinary ordering correction must not leak into classic.
4. **Graph layout.** Derive columns, connectors and indentation from the displayed graph after its display order is chosen. Cover fanout, multiple independent stacks under the one trunk, selected-stack views and reverse orientation. Preserve the resolved zero-depth contract and suppress its hidden-descendant connectors, even where the Graphite reference emits dangling connectors. Keep the existing terminal wrapping model; no new renderer framework or general Unicode-width engine is required.
5. **Worktree context.** Read Git's worktree records through the existing Git boundary and attach display labels to branches checked out outside the effective cwd worktree. Use the directory basename, not a literal Graphite prefix. Omit the effective current worktree's own label; include the main worktree when it is another worktree relative to a linked caller. Resolve cwd/worktree identity consistently with existing path handling. Treat labels as text, never branch identifiers; detached records do not create tracked branch labels. Preserve current/frozen/stale markers. This round does not introduce a new duplicate-basename disambiguation policy or prune worktree registrations.
6. **Scoped styling.** Use dim ANSI styling for full-log commit summaries rather than a hard gray color. Preserve existing current/status colors and no-color policy. Remove surplus branch-header trailing spaces without trimming user branch names or commit contents. Remove the extra final LF from non-paged long delivery without globally changing logging, pager input or unrelated commands' newline behavior. Native delivery must finish before exit.
7. **Long grammar.** Long means the existing Git commit-ancestry graph, independent of display selectors. Accept and ignore `--classic`, `--reverse`/`-r`, `--stack`/`-s`, `--steps`/`-n`, `--show-untracked`/`-u` and `--all`/`-a` on long routes. Keep their normal declared argument types and global option handling; do not make every unknown flag valid. This acceptance of `--all` is confined to ignored long-mode compatibility; ordinary full/short still do not offer working multi-trunk selection. Do not add short-only legacy `-c` to long or ordinary full.
8. **Routes and discoverability.** Preserve full `log`/`l`, short `log short`/`log s`/`l short`/`l s`/`ls`, and long `log long`/`log l`/`l long`/`l l`/`ll`. Remove duplicated help aliases at their registration boundary. Correct untracked help and describe the ignored long selectors. Let public completion reflect supported command options; do not redesign shell completion.
9. **Shared consumers and state.** Keep interactive selector values, conflict-status rendering and branch-info behavior separate from new log-only labels and ordering. Reuse existing inspection and pager policies. Do not introduce branch rewrites, worktree switching, freezing changes, metadata schemas or a new command-runner abstraction.
10. **Delivery and cost.** Use one implementation branch and one PR for the five areas. A short acceptance list and representative before/after outputs accompany it; this issue does not request implementation sub-issues. Run focused checks locally, then allow only existing cheap automatic CI. No full workflow dispatch/rerun, release-asset job, release publication or global installation is authorized by this specification. Unrelated failures are recorded separately instead of automatically expanding the round.

## Testing Decisions

Use **one existing seam: the built public CLI process**. Exercise Node entry points and a separately compiled native executable through the current subprocess/temporary Git fixture helpers. A PTY is an alternate transport at that same seam for color, width and paging; it is not a second private renderer seam. Assert externally visible stdout/stderr, exit status, branch identities and protected fixture state. Do not assert private sorting helpers, recursive call counts, cache layouts or implementation-specific data structures.

Prior art is the existing zero-depth full/short/options/state suites, classic-log and legacy-short regressions, cwd/inspection snapshots, and controlled PTY/pager and selector fixtures. Extend those facilities rather than adding a testing framework, a mock renderer or a private export solely for tests.

Use three reusable graph shapes: a minimal linear stack, the canonical branching single-trunk graph with an independent maintenance stack, and worktree variants of that graph. The targeted acceptance budget is the following **14 scenario groups**, not a Cartesian product of every flag, route, status and topology:

| Group | Observable acceptance                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Linear full/short output retains correct branch identities, current indication and commit details; representative full/short aliases agree.                                                                 |
| 2     | Canonical branching full/short output matches reference branch rows, graph columns and connectors; the empty tip and Unicode branch remain visible.                                                         |
| 3     | Reverse output matches the retained reverse layout and sibling sequence rather than reversing arbitrary internal arrays.                                                                                    |
| 4     | Bounded ordering controls vary tip timestamps, current checkout and sibling tracking order; ordinary layout remains consistent with the corresponding Graphite controls.                                    |
| 5     | Selected-stack and positive-depth controls retain their existing branch selection and do not acquire extra independent stack nodes.                                                                         |
| 6     | Zero depth retains the current-only graph and clean connectors; reuse the existing alias, numeric-spelling and recovery regressions rather than multiplying new presentation cases.                         |
| 7     | Full/short output shows another linked worktree's actual basename and preserves frozen/needs-restack text where present.                                                                                    |
| 8     | A linked-worktree caller keeps its own branch current and labels the main worktree's other checked-out branch; spaces/Unicode in a label cannot change a branch identity.                                   |
| 9     | Forced-color PTY output uses the intended dim commit style; a no-color counterpart contains no ANSI escapes.                                                                                                |
| 10    | Branch headers have no surplus trailing spaces, and non-paged long output matches the reference final-LF boundary.                                                                                          |
| 11    | Known long options are accepted and ignored through canonical/root/nested long entry routes; select representative options per route and cover the complete option set across the group.                    |
| 12    | Unknown long options still fail; ordinary full/short do not gain a misleading multi-trunk `--all` option.                                                                                                   |
| 13    | Help lists aliases once, describes untracked output accurately, and long help/completion agrees with accepted options; quiet/no-interactive and one existing pager transport control remain intact.         |
| 14    | Classic keeps its pre-change Anthracite sequence and ignores selectors; one representative real interactive selector retains the correct branch value and the existing conflict-status checks remain valid. |

Expected graph values come from the declared fixture and captured reference output, not from running the candidate renderer to generate its own expectations. Normalize only explicitly variable ages, equivalent fixture roots and the corresponding worktree basenames. Do not strip trailing spaces when verifying their removal, strip ANSI when verifying styling, or normalize away an absent worktree label. Compare raw final bytes for the long-LF contract. Use both exit status and decoded branch identities; exit zero alone does not prove a correct log.

For the log scenarios, observe branch heads, effective HEAD, tracked parent relationships, index and local files before/after. Reuse existing zero-depth recovery/config snapshots for the already fixed preservation contract. The new feature must add no mutations; transient existing cache behavior is not a promise to redesign every ordinary inspection path. No live GitHub fixture or account is needed.

Run the new groups and affected existing log/alias/selector controls once on each final Node/native candidate, together with build, lint and typecheck. Existing platform skips must be identified separately; every applicable new group must actually execute. Preserve concise per-group results and representative paired transcripts, without generating another exhaustive invocation matrix. After a code push, use only the existing cheap CI. Passing it is not a claim that the complete manual matrix or release gate ran.

## Out of Scope

- Multi-trunk storage, trunk switching, all-trunk full/short display, or a no-op `--all` pretending to provide that feature.
- Reconstructing or persisting Graphite's historical classic registration order; universal sorting claims across unmeasured histories, names or platform collation rules.
- PR/review badge parity, remote status refresh, Graphite authentication or service calls; those behaviors have not been established as missing by these local fixtures.
- Changing `CH_PAGER`, introducing a pager engine, broad parser/numeric-policy redesign, removing retained aliases or matching Graphite's verbose unknown-option help byte-for-byte.
- Copying Graphite's dangling zero-depth connectors, general line-wrapping/Unicode-width redesign, terminal-theme certification or automatic worktree-basename disambiguation.
- Engine-wide sibling sorting, mutation/navigation policy, metadata migrations, branch repair, worktree cleanup, frozen-state enforcement or continuation-format changes.
- A separate spec/ticket program for each display detail, unrelated flaky-test repairs, complete CLI/platform certification, paid full-matrix runs, release publication or automatic local installation.

## Further Notes

The principal uncertainty is the general sibling-order rule. The retained controls establish ordinary ordering on the canonical graph despite changed tip dates, current branch and tracking sequence. They do not certify a universal comparator. Classic is demonstrably different: retracking the same graph in a different order changes its classic sequence. The explicit decision above preserves Anthracite classic compatibility rather than inventing unavailable history to force an equality claim.

Historical primary evidence is the [original log comparison](https://github.com/danielbaars/dinky-misc/blob/93f969883324f5bb93a18005e8214f75f50e37dd/research/anthracite-graphite-log-parity-2026-10-27.md). It describes the old 0.1.1 zero-depth defect and is not evidence that the merged correction remains broken. Issue #1 and merged PR #6 cover that correction separately.

The fresh retained evidence accompanying this spec contains 11 paired pipe-mode cases (22 CLI invocations), two successful forced-color REA terminal captures, bounded ordering controls and a linked-cwd control against the installed development binary. The two REA records are `ev_03f946a6512beb824a59fb3194c72d13e35a2732fb3945e53f2242db666d15d2` and `ev_9a8df66163d8984f9f3cc02a383d18ef87ed24b6eead5388b8ce2ce1765c43c6`. They exited successfully without truncated output. They are process observations with sampled descendant coverage and no filesystem/network containment guarantee; no live PR behavior is inferred.

The first retracking-order setup attempted to track an already stale child against its advanced parent and was rejected. The accepted replay restores the recorded old parent revision during tracking and then advances it again, matching the original fixture preparation. This was a fixture-setup correction, not an observed product regression.

Durable evidence accompanying this specification:

- [Fixture identities and declared parent relationships](../verification/evidence/log-presentation-parity-2026-10-27/fixture.json).
- [Fresh paired pipe cases](../verification/evidence/log-presentation-parity-2026-10-27/current-results.json).
- [Ordering controls](../verification/evidence/log-presentation-parity-2026-10-27/ordering-results.json) and [accepted retracking-order control](../verification/evidence/log-presentation-parity-2026-10-27/tracking-order-result.json).
- [Linked-worktree caller control](../verification/evidence/log-presentation-parity-2026-10-27/linked-cwd-result.json).
- [Graphite REA capture](../verification/evidence/log-presentation-parity-2026-10-27/rea-gt.json) and [Anthracite REA capture](../verification/evidence/log-presentation-parity-2026-10-27/rea-an.json).
- [Byte sizes and SHA-256 manifest](../verification/evidence/log-presentation-parity-2026-10-27/manifest.json); replay scripts and original preparation receipts are retained alongside these records.

The [official Graphite command reference](https://graphite.com/docs/command-reference) documents long-mode option ignoring, worktree context and multi-trunk selection. Installed-version observations take precedence for this bounded comparison; newer website text is not proof of a newer binary's behavior.

No production implementation, paid CI run, PR workflow or installed binary is changed by publishing this specification. After implementation, report achieved acceptance groups and the classic/multi-trunk/unmeasured-status exceptions explicitly. A plain linear stack may still look largely unchanged, which is expected and must not be presented as unfinished work on these five agreed areas.
