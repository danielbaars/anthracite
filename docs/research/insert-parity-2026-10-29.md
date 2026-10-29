# `create --insert` parity: Graphite 1.8.6 and Anthracite 0.3.0

Research date: 29 October 2026. This is a behavior comparison and a bounded proposal, not an implementation specification. All mutation probes used synthetic local repositories. No GitHub PR fixture, CI run, package release, or active installation/configuration change was part of this investigation.

## Conclusion

The main missing feature is **interactive selection of the existing direct children to move beneath the inserted branch**. Graphite offers a multi-select list when there is more than one child; Anthracite and Charcoal insert beneath all of them. However, **Graphite also moves all children in noninteractive mode**. Its default interactive selection is all children, so merely pressing Enter produces the same scope as Anthracite.

The comparison also exposes two separate policy differences: Anthracite refuses predictable mandatory frozen/worktree participants before creating the branch; Graphite can change their parent metadata while skipping their physical replay. And a Graphite insert can return success with a needs-restack warning, whereas Anthracite enters a genuine replay conflict and returns nonzero. These policies should not be silently bundled into a child-selector fix.

## Actually observed behavior

The [observation records](../verification/evidence/insert-parity-2026-10-29/observations.json) retain command arguments, literal terminal output/events, exit status and independent Git/metadata snapshots. Branch relations are read from Graphite's generated SQLite metadata or Anthracite/Charcoal's metadata refs, rather than inferred solely from graph formatting. Git ancestry and inherited file contents corroborate completed replay.

| Scenario | Graphite 1.8.6 | Anthracite 0.3.0 |
| --- | --- | --- |
| No existing child | Creates the new branch; no selection is needed. | Same. |
| One child with a grandchild | Moves that child and replays its descendant. | Same. |
| Two children, interactive terminal | Prompts with **both selected by default**. Space toggles choices; Enter confirms. | No child-selection prompt; moves both. |
| Select only `left` | Moves `left` and `left-tip`; the `right` and `right-tip` refs and relationships remain unchanged. | No equivalent insert child-selector. |
| Deselect both | Refuses confirmation with “You must select a minimum of 1 choices.” It remains in the selector until a valid choice or cancellation. | No comparable selection stage. |
| Two children with `--no-interactive` | Moves both children and their descendants without prompting. | Same scope. |
| Non-TTY invocation without an explicit interaction flag | Moves both without prompting. | Same scope. This is a CLI observation, not a newly run MCP request. |
| `--onto parent`, invoked from an unrelated branch | Uses the specified parent's children. Interactive selection can move only `left`; noninteractive mode moves both. | Uses that parent's children and moves both; the unrelated branch ref stays unchanged. |
| Empty inserted branch, two children | Changes both parent relationships without adding a commit or changing their already-aligned Git tips. | Same. |

Charcoal 1.0.1 serves as a control: no-child, single-child and noninteractive fanout probes succeed with the same structural scope. An additional terminal fanout probe confirms it also moves both children without a selector. Its behavior is not inferred from Anthracite's source alone.

All ordinary successful insert probes finish on `inserted`. Unrelated and parent/trunk refs remain unchanged. The exact tested artifacts and hashes are in [identities](../verification/evidence/insert-parity-2026-10-29/identities.json). Anthracite is the installed npm 0.3.0 bundle, launched with the explicit existing Node runtime to avoid an unrelated mise shim trying to install a runtime.

## Cancellation and mutation timing

In the Graphite terminal capture, the new commit appears **before** the child-selector prompt. This does not mean cancellation necessarily retains it: in a fresh Ctrl-C probe, Graphite exits 1, removes `inserted`, returns to `parent`, preserves all original branch refs/relationships, and returns the original staged `inserted.txt` with the same content and no unstaged delta. The zero-selection validation followed by Ctrl-C has the same observed result.

The raw index checksum changes in these cancellation probes. This report claims preserved staged content and branch relationships, not byte-for-byte restoration of Git index/cache/reflog administration or universal rollback for arbitrary hooks/failures. Anthracite currently has no corresponding selection cancellation point.

## Protection differences and why selection matters

Two independent protected-right-arm fixtures were exercised: `right` frozen, and `right` checked out in another worktree.

- Graphite with all children selected, including noninteractive insertion: creates the branch/commit, changes **both** direct children's parent metadata to `inserted`, replays the editable left arm, and skips the protected right replay. It returns 0 with a diagnostic. The right arm's physical refs stay at their old commits even though its direct parent metadata now names `inserted`; this is not a completed physical restack of that arm.
- Anthracite: returns 1 before creating `inserted` or committing/reparenting. In these fixtures, original branch refs, parent relationships, working files and staged status remain unchanged. This does not assert that ordinary CLI context/cache setup has zero administrative effects.
- Graphite interactively selecting **only `left`**: succeeds even when the unselected right arm is frozen or occupied. Both right-arm refs and their original parent relationships remain unchanged. This is a concrete useful workflow currently unavailable through Anthracite's all-children insert.

Anthracite's stricter mandatory-participant protection is already a documented deliberate choice in [COMPATIBILITY.md](https://github.com/danielbaars/anthracite/blob/9fa53077d9c7a52bc2b903799ab9b7a74da2d8ba/COMPATIBILITY.md#L96). The improvement is to compute that mandatory set from an explicit chosen subset, while retaining protection within the subset and its required descendants. There is no reason to copy the unsafe metadata-change/skip behavior merely to add selection.

## Conflict behavior differs too

A paired fixture inserts a new `left.txt` while the existing left child independently adds the same path with different content.

1. **Graphite:** `create --insert --no-interactive` returns **0**, retains the inserted branch/commit and changed child parents, successfully replays the right arm, and reports that `left` could not be restacked cleanly. It leaves no active unmerged index and says to run `gt restack`.
2. A fresh **`gt restack --no-interactive`** then returns 1 with the actual left replay conflict. Deliberate resolution and fresh `gt continue --no-interactive` complete the remaining work.
3. **Anthracite:** `create --insert --no-interactive` returns **1** at the actual left conflict, retaining the inserted branch/commit, parent changes and the already replayed right arm. Its diagnostic explicitly limits what raw Git rebase abort would undo. Deliberate resolution and fresh `an continue --no-interactive` complete the work.

Both final states check out `inserted`, have both children below it, preserve the deliberate resolved content in `left` and `left-tip`, and have clean status. Every child/tip is verified to descend from the inserted commit. The extra Graphite restack and two continue results are retained with the conflict records. An early harness assumption that Graphite create would immediately leave an active conflict was corrected after its actual output/state contradicted it; that assumption is not reported as a product failure.

For agents, Graphite's zero exit status therefore does not by itself establish that insertion replay finished. Anthracite's explicit conflict failure is a useful existing behavior, not inherently a missing parity feature. Broader hook failure, raw abort/undo, interrupted continuation, dirty-source and arbitrary path-collision behavior were not re-exercised in this comparison.

## What source inspection establishes separately

[Source findings](../verification/evidence/insert-parity-2026-10-29/source-findings.md) cover child enumeration, selected-parent resolution, commit/reparent/replay order, mandatory participants, file guards, conditional failure cleanup and existing tests. [Blob comparison](../verification/evidence/insert-parity-2026-10-29/source-comparison.json) proves all 21 examined source/docs/test blobs match release commit `9fa53077d9c7a52bc2b903799ab9b7a74da2d8ba`.

In particular, [create_branch.ts](https://github.com/danielbaars/anthracite/blob/9fa53077d9c7a52bc2b903799ab9b7a74da2d8ba/apps/cli/src/actions/create_branch.ts#L168) snapshots every valid tracked direct child of the chosen parent; no child-selector path exists. Checked-in tests cover fanout, frozen/occupied participants and recovery. Their presence is source evidence, not a claim that this investigation reran those whole suites.

Graphite's shipped `create --help` agrees with its [official command reference](https://graphite.com/docs/command-reference): multiple children trigger selection. Its [official changelog](https://graphite.com/docs/cli-changelog) records the introduction of that selection and a later 1.7.12 branch-selection fix. Documentation supports the intended interface; the local 1.8.6 probes establish the runtime details above.

## Bounded next change

A focused implementation can keep existing defaults and safety policy:

1. When interactive insertion has multiple direct children, offer Graphite-like multi-selection, initially all selected, with at least one required. No selector for zero/one child. Cancellation must preserve user-visible original work and topology; selecting before mutation would avoid needing to recreate Graphite's commit-then-rollback sequence.
2. Derive parent changes, preflight and mandatory replay only from the chosen children and their required descendants. Do not inspect a whole fanout as if every arm were selected; retain existing frozen/worktree/path guards for actual participants. Support both current-parent and `--onto` routes.
3. Keep noninteractive **all-children** behavior for compatibility. If agents need targeted insertion too, add an explicit literal child-list option through the existing MCP command route. That would be an Anthracite extension: no such selector is documented in the tested Graphite `create --help`, and hidden interfaces were not exhaustively reverse-engineered.

Keep Graphite's deferred-conflict policy as a separate decision. It is not required to deliver child selection. This proposal changes no code and does not open implementation issues or a PR.

## Evidence limits and reproduction

The fixture helpers and terminal driver are retained beside the observations. `$FIXTURE_ROOT`, `$NODE_PREFIX`, `$SOURCE` and `$INTEGRATION` are portable placeholders requiring substitution; they are not shell-expanded by Python subprocess calls. Regenerate disposable repositories rather than reusing already-mutated captures. Ordinary subprocess captures use non-TTY pipes; the terminal driver uses a real PTY. Reproduction helpers now use explicit closed stdin for ordinary captures and a 60-second ceiling; the initial bounded noninteractive captures inherited a non-TTY input descriptor and used a 30-second ceiling.

An initial REA 6.7.0 process capture recovered the selector and cancellation but failed macOS cleanup identity verification (`platform_binary_environment_withheld`). Its [partial capture](../verification/evidence/insert-parity-2026-10-29/rea-partial-capture.json) is not a successful canonical REA Evidence record or proof of full process cleanup. Fresh ordinary Python PTY probes and independent Git snapshots corroborate the report. No unverified PIDs were killed.

Four initial Anthracite PTY runs and one empty-selection Graphite run hit an insufficient 12-second harness ceiling. They are excluded; complete fresh probes with a 60-second ceiling supply the relevant conclusions. A redundant all-default Graphite terminal run is not needed for the accepted record set. Some initial sandboxed Git calls emitted a Darwin temporary-directory warning; observed exit/state assertions still passed. Later supplemental probes ran outside that sandbox. These are execution qualifications, not Anthracite regressions.

Only local synthetic fixtures and normal CLI effects were observed. A controlled `gh`/editor sentinel was not called in accepted probes. That is not a network trace: Graphite background telemetry and arbitrary inherited host behavior are not certified absent. The report does not claim exhaustive Graphite equivalence, native-platform coverage beyond this macOS ARM64 host, or complete recovery/rollback semantics. [Validation](../verification/evidence/insert-parity-2026-10-29/validation.json) and the [file manifest](../verification/evidence/insert-parity-2026-10-29/manifest.json) preserve the checked scope.
