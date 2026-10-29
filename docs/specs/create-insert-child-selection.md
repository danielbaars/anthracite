## Problem Statement

A developer inserting a shared prerequisite below one branch can unintentionally move every sibling below it. Anthracite 0.3.0 always makes every existing tracked direct child of the chosen parent a child of the inserted branch. A protected sibling can therefore prevent useful work on an independent editable arm. Agents have no explicit way to state a narrower insertion scope through the CLI or its existing MCP execution tool.

The pinned comparison establishes a bounded Graphite 1.8.6 difference: its interactive multi-select can move only chosen children, initially selecting all and requiring at least one. Its noninteractive behavior still moves all children. Anthracite should add that interactive capability and an explicit agent-friendly selector while retaining its existing noninteractive default, stricter participant protection and explicit conflict failure.

## Solution

Allow developers to choose which direct children become children of a new branch during create --insert. With multiple candidates and effective terminal interaction, show a multi-select list with all children initially selected and at least one required. Select before staging or creating the branch, so cancellation needs no compensating rewrite.

Add repeatable --insert-child options for exact child names. They require an active --insert and determine the child set without a child-selection prompt in every interaction mode. Without explicit child options, noninteractive insertion retains the all-children default. Resolve children relative to --onto when supplied, otherwise the current tracked parent or trunk.

Reparent only the chosen children and replay their necessary tracked descendants. Preserve unselected branch refs and relationships, and retain all existing protection within the actual mandatory scope. Keep the current Anthracite nonzero conflict outcome and fresh-process continue behavior. Agents use the existing MCP tool with literal arguments; there is no new service, tool or publication permission.

## User Stories

1. As a developer, I want to insert a prerequisite below one child, so that independent sibling stacks do not acquire that dependency.
2. As a developer, I want to select several children together, so that shared prerequisite work reaches exactly the relevant arms.
3. As a developer, I want the menu initially to select every child, so that accepting the familiar scope is quick.
4. As a developer, I want the menu to identify the chosen parent and candidate names, so that I can understand the insertion target.
5. As a developer, I want at least one child required when confirming a multi-child menu, so that insert cannot silently mean selecting none.
6. As a developer, I want to cancel selection before the new branch exists, so that changing my mind does not require undo.
7. As a developer, I want existing staged work preserved on cancellation, so that preparing a commit is not lost.
8. As a developer, I want unstaged, untracked and ignored work preserved on cancellation, so that declining insertion has no user-visible work effects.
9. As a developer, I want cancellation before --all stages anything, so that unprepared input retains its role.
10. As a developer, I want child selection completed before patch or editor interaction, so that I do not prepare work for a scope I will reject.
11. As a developer, I want no child menu when the parent has no children, so that ordinary empty-position creation remains straightforward.
12. As a developer, I want a sole existing child selected automatically, so that routine insertion gains no unnecessary prompt.
13. As a developer, I want insertion beneath an explicit --onto parent, so that I need not check out that parent first.
14. As a developer, I want candidates to belong to the chosen parent rather than the departure branch, so that --onto does not select the wrong stack.
15. As a developer, I want to invoke --onto from an unselected arm, so that selecting another arm does not rewrite my original branch.
16. As an agent user, I want to specify one child explicitly, so that targeted insertion needs no terminal.
17. As an agent user, I want repeated child options to specify multiple branches, so that scope remains a literal argument array.
18. As an agent user, I want explicit choices to suppress only the child menu, so that ordinary message and staging requirements remain predictable.
19. As an agent user, I want omitted choices in noninteractive mode to retain all-children behavior, so that existing scripts continue working.
20. As a CLI user, I want child names matched exactly, so that abbreviations and patterns cannot move an unintended branch.
21. As a CLI user, I want commas and numeric-looking names treated literally, so that list parsing or type coercion cannot change branch identity.
22. As a CLI user, I want repeated identical names normalized once, so that one child cannot be reparented or replayed twice.
23. As a CLI user, I want missing or empty child values rejected, so that malformed commands cannot broaden the scope.
24. As a CLI user, I want unknown, untracked or non-child names rejected together with the unsafe request, so that a partially valid list does not cause a partial insertion.
25. As a CLI user, I want grandchildren refused as explicit child candidates, so that selection cannot bypass an intermediate branch.
26. As a CLI user, I want child options without an active insert rejected, so that an ignored selector cannot appear successful.
27. As a developer, I want selected children to become direct children of the inserted branch, so that the new prerequisite has the intended topology.
28. As a developer, I want every necessary descendant of a selected child replayed, so that no selected arm is left stale.
29. As a developer, I want unselected children and their descendants to retain their branch refs and logical relationships, so that unrelated work is not rewritten.
30. As a developer, I want trunk, the chosen parent and unrelated branches retained, so that insertion affects only its declared scope.
31. As a developer, I want existing own commit order, authors and messages retained during replay, so that history remains attributable and recognizable.
32. As a developer, I want branch names, PR linkage and protection status retained, so that targeted insertion does not duplicate PRs or reset ownership.
33. As a developer, I want a frozen unselected sibling excluded from mandatory checks, so that it does not block editing an independent arm.
34. As a developer, I want an occupied unselected sibling and its dirty worktree preserved, so that another checkout remains usable.
35. As a repository owner, I want selected frozen children refused before staging or branch creation, so that parent changes cannot bypass protection.
36. As a repository owner, I want necessary frozen or occupied descendants refused, so that narrowing the roots does not weaken replay safety.
37. As a developer, I want unchanged read-only anchors and aligned deeper branches to retain their established treatment, so that protection does not become a blanket stack ban.
38. As a developer, I want selected-child protection even for an empty inserted branch, so that a metadata-only parent change remains deliberate.
39. As a developer, I want source and selected relationships rechecked after waiting at a menu, so that stale choices do not rewrite changed work.
40. As a developer, I want existing hook-boundary checks retained, so that a late blocker produces an honest refusal and reached-state diagnostic.
41. As a developer, I want existing staged-only, all and patch rules retained, so that child selection does not redefine commit input.
42. As a developer, I want normal successful creation to leave the new branch checked out, so that I can continue working on the inserted prerequisite.
43. As a developer, I want a genuine replay conflict to return nonzero, so that automation cannot mistake incomplete insertion for success.
44. As a developer, I want deliberate resolution continued in a fresh process, so that recovery survives the original terminal or agent session.
45. As a developer, I want continuation to retain the original chosen scope, so that it cannot rediscover and move unselected siblings.
46. As a developer, I want newly protected mandatory participants rechecked before continuation stages or advances, so that a pause cannot bypass safety.
47. As a developer, I want prior completed work and raw-abort limitations reported accurately, so that recovery is not mistaken for universal rollback.
48. As a CLI user, I want create/c, insert/-i, quiet and effective cwd behavior to remain consistent, so that familiar routes reach the same feature.
49. As a CLI user, I want help and completion to explain literal child selection and defaults, so that the interface is discoverable.
50. As an agent user, I want existing MCP discovery, learning and execution envelopes preserved, so that targeted insertion needs no new integration.
51. As a maintainer, I want legacy saved insert operations still continuable, so that upgrading does not migrate or invalidate interrupted work.
52. As a maintainer, I want public CLI tests with independent Git assertions, so that the implementation does not certify its own selection plan.
53. As a maintainer, I want focused Node/native coverage and one installed npm/MCP smoke, so that delivery is checked without duplicating the transport suite.
54. As a repository owner, I want one implementation PR and inexpensive CI, so that this improvement does not restart the full paid matrix.

## Implementation Decisions

1. **Scope vocabulary.** The chosen parent is the exact local tracked branch or trunk selected by --onto, or the current valid tracked branch/trunk when --onto is absent. A candidate is an existing valid tracked local direct child of that parent. Chosen children are a set of those candidates. The insertion changes their direct parent to the new branch. Necessary replay means the existing structural replay closure of the chosen arms, preserving each descendant's own range. This does not select arbitrary commits, remote refs, grandchildren as roots, or siblings of another parent.

2. **Explicit CLI contract.** Add --insert-child as a repeatable string option on create and its c alias, without a short alias. Every occurrence consumes exactly one nonempty branch name. It requires an active --insert/-i; missing insert and explicitly disabled insert both refuse before staging, checkout or creation. The child option does not implicitly enable insertion. Unknown arguments retain normal parser failure. No positional child list, comma splitting, globbing, prefix lookup or branch-name sanitization is applied to child values. The ordinary new-branch naming policy remains unchanged.

3. **Literal normalization and validation.** Preserve numeric-looking and Unicode names as strings; a value such as false is a literal candidate name rather than an option toggle. Deduplicate exact repeated values. Resolve every supplied name against the chosen parent's candidates before using any of them. Any invalid value refuses the whole request; do not silently discard it, fall back to all children, prompt for replacement, or expand a descendant to its ancestor. Empty/missing values and boolean negation of the string option are invalid. Childless explicit selection therefore refuses. Selection represents a set, not a requested sibling replay order.

4. **Mode precedence.** A valid explicit child set is authoritative in both terminal and noninteractive execution and suppresses the child menu. It does not suppress a legitimate editor or patch interaction elsewhere in create. Without explicit children, zero candidates require no menu; one candidate is automatic; multiple candidates use a menu only when the existing effective interaction policy permits prompting. Otherwise select all candidates, including with quiet, disabled interaction or non-TTY input/output. Forcing the interactive option cannot manufacture a usable terminal. Do not introduce a new confirmation/force flag.

5. **Interactive menu.** Display the chosen parent and exact candidate names, using established branch display conventions. Initially select every candidate, allow an arbitrary nonempty subset and require at least one at confirmation. A zero-selection attempt stays in the menu with an actionable validation message. Cancellation exits nonzero. Protected candidates must not make discovery refuse the whole fanout before a user can deselect them; selected protection is enforced after scope resolution. The menu is not a branch-reordering UI. No exact cursor coordinates, sibling replay order or ANSI layout are public contracts.

6. **Selection before mutation.** Resolve and validate the child set before branch checkout/creation, staging, patch application, editor invocation, new commit, insert recovery publication or parent changes. Ordinary argument validation, established source-operation preconditions and read-only/context discovery may precede selection. Do not compensate for a selection cancellation by creating and then deleting the branch. An invalid selection or cancellation retains the original checkout, branch refs/relationships, staged contents and modes, unstaged changes, and untracked/ignored work. Ordinary cache or index stat bookkeeping is not a promise of byte-identical Git administration. This adds no bypass for an existing active Git/recovery operation.

7. **Single resolved selection.** Pass the chosen parent and immutable normalized child set from command handling into creation/preflight/replay. Separate candidate discovery and child choice from mandatory-participant validation; a helper must not silently rebuild an all-children plan later. Prefer extending the existing create action and structural planning interfaces over a parallel rewrite engine, new public engine API or generic transaction system. Selection is local application input, not a stored stack-format migration.

8. **Mandatory participants.** Every chosen direct child is mandatory because its parent changes, even if the inserted branch is empty and its Git tip does not require rebasing. Include descendants whose history must actually replay according to the existing planner. Apply frozen, worktree, file/path and dirty-source checks to that resolved scope and the invoking source as appropriate. Preserve the established treatment of unchanged read-only parents and aligned deeper branches. Do not skip a protected mandatory replay while publishing a changed parent for it.

9. **Unselected arms.** Do not reparent, rebase, write branch metadata/PR identity, or consume recovery work for unselected children or their descendants. Preserve their refs, commit trees, parents, protection and local PR associations, apart from independently made external changes. Their frozen/occupied status alone cannot block insertion into another arm. Preserve foreign worktree files, HEAD and index. When the invoking source itself is an unselected arm, the command may check out the new branch and apply selected commit input under existing --onto rules; preserving the source branch ref does not mean retaining that branch's baseline as the new working-tree baseline. Source dirt and actual path obstructions remain real blockers even when an arm is unselected.

10. **Revalidation and late blockers.** After a menu wait, refresh relevant state before mutation: verify the original source/parent and chosen child tips and direct-parent relationships still describe the selection. A relevant change while waiting refuses without overwriting that external change or broadening selection. Unselected-arm changes do not by themselves broaden the set or become mandatory. Compute/check required descendants from validated topology, and retain existing checks after checkout, at the commit boundary, before parent changes, during replay and on continuation. A late failure after mutation reports actual reached state; there is no new guarantee that every hook/ref race is transactional.

11. **Creation and replay.** Use the existing new-branch creation and optional commit behavior above the chosen parent, then change only chosen direct parents and replay required descendants parent-first. Retain original own commit order, authors and full messages, local branch/PR identity, unknown metadata fields and protection. Rewritten commit IDs and signatures may change. Preserve the established treatment of redundant/empty commits; this feature does not change the existing replay drop/retain policy. Successful replay finishes on the new branch. An empty insertion can change selected logical parents without creating a commit or needlessly rewriting aligned commits. Do not introduce an incidental global restack or reinterpret --onto's departure-input rules.

12. **Existing staging and verification rules.** Staged-only input remains the default. Preserve create's current --all behavior and its existing precedence over --patch when both are active; preserve patch's terminal requirements and existing early refusals. This feature does not make previously unsupported dirty/partial insertion combinations succeed. Child selection and validation must finish before any staging side effects. A missing noninteractive commit message remains an error under existing rules. Existing hooks and verification choices remain authoritative; selecting fewer children is not permission to bypass them.

13. **Saved selection and continuation.** Persist or reuse enough chosen-scope information in the existing insert recovery role and remaining replay queue that fresh continue resumes only the selected operation. Preserve completed work and original own replay ranges; do not rerun the menu or enumerate every current sibling. Recheck actual pending mandatory participants before --all stages resolutions or continuation advances. A refusal retains staged resolutions and the reached operation. Reuse current recovery machinery; any necessary new saved fields are optional and missing fields preserve legacy continuation meaning. Do not reinterpret old saved operations as an empty selection or rediscover a new larger scope.

14. **Conflict and other failure policy.** Preserve Anthracite's immediate nonzero outcome for a genuine replay conflict, its actual active-rebase continuation instructions, and its truthful diagnostics for retained branch/commit, parent changes and completed replays. Fresh resolution/continue may succeed without repeating already completed work. Non-rebase failures retain their existing bounded manual recovery guidance. Raw Git abort cancels its active rebase and does not promise restoration of earlier parent changes or completed work. Graphite's successful create with deferred needs-restack warnings is explicitly not adopted here.

15. **CLI presentation.** Update help, completion and user documentation for create/c, --insert/-i and --insert-child, including exact matching, repetition, defaults and --onto scope. Normal progress identifies the chosen parent and chosen children rather than implying the whole fanout was selected. Quiet suppresses routine output and child prompting but preserves errors and recovery guidance. Existing effective cwd, subdirectory and literal argument behavior remain authoritative. No new preview command or machine-readable output format is introduced.

16. **MCP and local authority.** Existing learning describes explicit child selection and the all-children noninteractive default. Existing execution accepts the literal CLI argument array and absolute cwd, with the same tool list, serialization, cancellation and success/failure envelope. Explicit child selection performs only local creation and rewriting; it does not fetch, push, authenticate, submit PRs, change roles or grant publication authority. No new MCP tool or transport is required.

## Testing Decisions

The owner approved the boundary on 29 October 2026: one primary behavioral seam, the built public CLI against real temporary Git repositories, with real PTY interaction where required. Reuse the existing create fixture, structural insert/recovery/freeze suites, terminal staging driver and SDK stdio client. Extend fixture data only as needed. Do not export private selection helpers or mock the engine, prompt implementation, replay planner or Git to prove the feature.

A good test declares the intended child set independently, invokes public commands, then checks Git refs/ancestry/trees, tracked parent relationships, own commit history, local PR identity, checkout, staging roles and work. The implementation's own menu, plan or log is not the oracle. Distinguish pre-mutation refusal/cancellation from failures after reached work. Keep unselected-arm invariants separate from legitimate checkout/input effects in the invoking worktree. Assert meaningful prompt content and observable choices, not exact terminal frames or sibling processing order. Use adequate bounded PTY deadlines; a killed harness is not a product failure.

The following is a bounded acceptance set, not every flag/history/path Cartesian combination. Combine related parsing controls in shared fixtures and use aliases as representative routes rather than duplicating every scenario.

| Case | Observable acceptance |
| --- | --- |
| T1 — established defaults | With zero children, normal creation works without a child menu. With one child and a descendant, insertion selects the child automatically and replays only what is necessary. Include an empty insertion and an ordinary create without insert control. |
| T2 — terminal subset | On a fanout with descendants on both arms, a real PTY chooses only one child. That arm gets the inserted prerequisite and retains its own commits/metadata; the other arm retains its refs, trees and parents. The new branch is checked out. |
| T3 — menu defaults and cancellation | Enter accepts all initially selected children. Deselecting all produces validation and no mutation while the menu remains active. Ctrl-C returns nonzero with original refs, parents, checkout, staged contents/modes and working bytes intact. Include cancellation with staging options so --all/patch/editor effects cannot precede the choice. |
| T4 — explicit literal set | Repeated --insert-child values select a subset without a child menu, in both terminal and noninteractive use. Exact duplicates act once. Representative comma-containing, Unicode and numeric-looking valid names preserve spelling and are not split/coerced. Arguments do not prescribe sibling replay order. |
| T5 — invalid explicit requests | Missing/empty values, selector without active insert, nonexistent/untracked names, a grandchild and a branch under another parent refuse the whole request before staging/creation. A mixed valid/invalid list cannot partially apply or fall back to all. Original user-visible work/topology is retained. |
| T6 — chosen parent and departure | Exercise --onto from an unrelated source and from an unselected arm. Candidates/selection belong to that parent, selected commit input follows existing onto rules, and source/unselected branch identities remain unchanged. Refuse a name that is a child only of the departure branch. |
| T7 — independent protected arm | In separate frozen and occupied-right-arm fixtures, select the editable left arm successfully while preserving both right-arm refs/parents and dirty foreign worktree files/index. Selecting the protected direct child refuses before staging or branch creation, including an empty metadata-only insertion. |
| T8 — required descendants | A mandatory frozen or occupied descendant of a chosen child refuses before effects. An unchanged read-only parent or aligned deeper branch retains existing permissive behavior. Validate the selected closure rather than every arm above the parent. |
| T9 — input and history compatibility | Exercise staged input and --all with selected arms; preserve applicable dirty-work/path guards, hooks, authors/messages/order and opaque local PR/metadata fields. Keep current all-over-patch precedence and non-TTY patch refusal. Do not require new support for an already-refused partial-work case. |
| T10 — changed selection state | Use the real PTY driver's existing before-input hook to freeze or change a relevant chosen participant while the menu is open. Refuse before insertion effects, preserving the external change and original work. Retain a representative existing post-commit protection control with truthful partial-state reporting. |
| T11 — genuine selected conflict | Create an actual replay conflict in the chosen arm and assert a nonzero create result. Resolve deliberately and continue in a new process. Check original own ranges, completed work, final checkout and selected-only ancestry; unselected refs/parents stay outside recovery. |
| T12 — paused scope and legacy recovery | A newly protected pending mandatory participant blocks continuation before --all stages/advances and retains the resolution for a valid retry. An unselected protected sibling does not become mandatory. Keep existing legacy insert continuation controls green; new optional selection data must not invalidate them. |
| T13 — public routes | Check create/c, insert/-i, help/completion and effective cwd. Without explicit child options, --no-interactive, quiet and non-TTY input retain all-children behavior; explicit choices remain authoritative. Verify normal diagnostics name the selected scope and quiet retains actionable failures. |
| T14 — one installed npm/MCP smoke | Through one persistent SDK stdio connection to the isolated installed candidate, discover the unchanged tools, read updated learning, explicitly insert beneath a chosen child using literal args, and independently verify the other arm is unchanged. An invalid child request retains state and the existing error envelope. No global installation, client configuration or live GitHub change. |

Run the focused CLI acceptance and justified existing create/structural protection/recovery controls on Node and the independently built host-native executable. Run the installed npm/MCP smoke once for the final immutable candidate. Build/lint/typecheck remain required. Only broaden controls when a concrete implementation change or failure justifies it. No Graphite binary, authentication or live service is a test dependency: pinned research supplies reference behavior and fixtures declare independent expectations.

Keep one implementation PR and existing cheap CI. Do not start the complete repository suite, full CI matrix or native release-asset matrix for this feature. These are acceptance decisions for later implementation; no new implementation test result is claimed by publishing this specification.

## Out of Scope

- Adopting Graphite's deferred-conflict success status or its protected-parent-change/skip-replay behavior.
- Selecting arbitrary descendants, commits, remote branches, children of several parents, or an empty explicit child set.
- A branch reorder interface, glob/prefix matching, comma-separated lists, new aliases beyond existing command routes, or a new preview/output protocol.
- Redesigning create's staging, patch, dirty-work, branch naming, detached-source, hook or --onto semantics beyond integrating child selection safely.
- General transactions, automatic undo/rollback, a new rewrite engine, automatic post-abort retry, or universal concurrency guarantees for arbitrary external hooks/ref changes.
- Stack metadata migrations, replacing legacy stored names, new MCP tools/transports, GitHub publication workflows, release/npm publication or changes to the user's active installation.
- Live GitHub mutation tests, broad re-testing of unrelated Graphite features, full paid CI and standalone release assets.

## Further Notes

The measured basis is the [insert parity report and runtime evidence](https://github.com/danielbaars/anthracite/blob/62dda56149dea36f47bd47aa34f3886ea1a1962e/docs/research/insert-parity-2026-10-29.md): Graphite 1.8.6, installed npm Anthracite 0.3.0 and Charcoal 1.0.1 controls. Thirty accepted scenario records, plus an explicit Graphite restack and two fresh continue calls, establish the bounded observations. Twenty-one examined source/docs/test blobs match Anthracite release commit 9fa53077d9c7a52bc2b903799ab9b7a74da2d8ba. They do not establish unimplemented selector behavior.

Explicit --insert-child is an Anthracite extension for agents, not a claim that the tested Graphite help exposes such a flag. The earlier REA capture's cleanup qualification, excluded short-deadline PTY attempts and source-versus-runtime distinctions remain in the linked research. They must not be relabeled as successful implementation acceptance.

The owner approved the public CLI/real Git/real PTY boundary, focused Node/native runs and one installed npm/MCP smoke on 29 October 2026. Interface details above synthesize that approved scope and the established conversation; the specification does not start implementation or CI. Preserve inherited license, credits and compatibility while implementing it.
