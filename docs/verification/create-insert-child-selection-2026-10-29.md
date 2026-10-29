# Targeted child insertion acceptance — 29 October 2026

This record covers the integrated implementation of #49 and #50–#53, following
[the canonical T1–T14 specification](../specs/create-insert-child-selection.md).
The delivery uses the existing create/c command, real Git/PTY boundaries and the
same two MCP tools. [User guidance](../targeted-insertion.md) explains the public
contract. No release or publication is claimed here.

## Fixed candidate

The candidate was frozen on parent `4eb9e8cee14d2a062cc4abf86f26899ab437e6f1`
before final acceptance. The [source manifest](evidence/create-insert-child-selection-2026-10-29/source-manifest.json)
identifies product source, test source, scripts, package/lock inputs and user
guidance. It excludes this later verification record and its proof files, avoiding
a self-referential commit claim. Node/native/npm checks used that unchanged
candidate; documentation evidence was added afterward.

The [basis](evidence/create-insert-child-selection-2026-10-29/basis.json) records
exact SHA-256 identities for the source/emitted manifests, complete source and
Node archives, host-native executable, npm tarball and extracted npm entry point.
The complete artifacts and raw reports are retained outside the author worktree
at `/private/tmp/anthracite-insert-implementation-20261029/evidence-53`, so author
worktree cleanup does not remove them. The source manifest is reproducible from
the commit containing this document; artifact identity does not depend on the
commit hash of the verification prose.

Runtime: Node **24.19.0**, Bun **1.3.14**, independently compiled native executable
on **Darwin 27.2.0 arm64**. Existing locked dependencies were reused. No dependency,
SDK transport, authentication or continuation-format migration was added.

## Final acceptance

**193 distinct cases pass on Node and the same 193 pass on the host-native candidate**, with zero failures/pending cases per runtime: 80 feature cases and 113 existing controls. The installed npm selection separately passes **7 cases**, consisting of **one new T14 session and six existing package controls**. Counts are actual final executions, not sums of development iterations.

| Final file selection | Cases per Node/native runtime |
| --- | ---: |
| `create_insert_child_cli.test.ts` | 34 |
| `create_insert_child_recovery_cli.test.ts` | 6 |
| `create_insert_interactive_cli.test.ts` | 36 |
| `create_insert_routes_cli.test.ts` | 4 |
| `create_onto_cli.test.ts` | 62 |
| `create_onto_insert_cli.test.ts` | 23 |
| `create_onto_recovery_cli.test.ts` | 9 |
| `freeze_structural_recovery_cli.test.ts` | 9 |
| `modern_completion_cli.test.ts` | 7 |
| `freeze_structural_cli.test.ts` | 3 |


[The exact case inventory](evidence/create-insert-child-selection-2026-10-29/case-inventory.json)
records every executed file and full test title. Its Node/native inventories
match after normalizing runtime paths. [Commands](evidence/create-insert-child-selection-2026-10-29/commands.json)
record build, fresh no-emit, uncached lint, native/npm builds and bounded test
selections. Build, typecheck, full CLI source lint and all five feature/SDK test
files pass; `git diff --check` passes. Final source/emitted/native/npm hashes were
rechecked after execution. Earlier author-ticket counts are not added here.

| Case | Final public coverage and independent observations |
| --- | --- |
| T1 | Ordinary create/onto controls; zero/one-child terminal defaults; empty/aligned insertion refs and parents. |
| T2 | Real PTY subset and descendants; chosen own history/metadata, untouched arm and final checkout. |
| T3 | Initial accept-all, zero-choice validation and cancellation preserving staging modes and work, including all/patch/editor ordering. |
| T4 | Repeated/duplicate literal comma, Unicode, numeric and false-looking names; terminal explicit precedence. |
| T5 | Missing/empty/negated, inactive-insert, unknown/untracked/non-child/grandchild and mixed invalid requests; original work and metadata retained. |
| T6 | Onto from unrelated and unselected departure arms; chosen-parent candidates and retained source identities/input guards. |
| T7 | Frozen and occupied unselected arms succeed; selected protected children refuse, including empty insertions. |
| T8 | Mandatory frozen/occupied descendants refuse; unchanged frozen anchors/aligned deeper worktrees remain usable. |
| T9 | Staged/all/patch precedence, dirty/path guards, hooks, own author/full messages/order, PR and opaque metadata. |
| T10 | Real PTY state races, fresh chosen descendant closure and independent sibling changes; late hook controls report retained reached work. |
| T11 | Actual selected replay conflict returns nonzero; fresh-process/PTY resolution retains own ranges, completed prefix and unselected arms. |
| T12 | Pending frozen/worktree guards precede all staging/advance and permit deliberate retry; unselected/completed worktrees and legacy queue/insert controls. |
| T13 | Four delivery-route cases plus menu mode controls and seven existing completion callers: create/c, insert/-i, exact scope diagnostics, quiet errors, effective cwd/subdirectories, no-interactive/non-TTY and forced interaction without a terminal. |
| T14 | Exactly one installed scenario 17: persistent SDK discovery/learning, literal comma/Unicode child and absolute cwd; independent refs/parent/history checks; invalid child preserves state and established cli_error envelope. |


The existing controls deliberately cover ordinary create/onto behavior and its
input/path/worktree guards (the complete 62-case file), established insertion
and empty/aligned insertion behavior, legacy and non-insert continuation loading,
late structural metadata/protection boundaries, and completion/help callers.
They are a bounded affected selection, not the complete repository suite.

The installed package check ran offline once from the frozen tarball into a
disposable prefix with isolated HOME/npm configuration and no lifecycle scripts.
The enclosing script also verifies both command names, completion, curated
package contents and unchanged license/credits. Its existing six selected
controls include absorb, numeric-zero cancellation and local publication
fixtures. Those fixtures use local Git and simulated hosting responses; no live
GitHub changes occur. Only scenario 17 is the new targeted-insert T14 check.
[The retained wire record](evidence/create-insert-child-selection-2026-10-29/t14-wire.json)
contains one initialization, unchanged discovery, updated learning and both the
successful literal-child request and invalid-child response in one persistent
SDK stdio session. Independent real Git assertions check unselected refs and
parent metadata, selected history, final checkout and refusal preservation.

## Provenance and limits

The [provenance record](evidence/create-insert-child-selection-2026-10-29/provenance.md)
separates genuine help/completion reds from the initial incorrect completion
harness invocation, which appended an option after the final completion word.
Those harness failures are neither product regressions nor acceptance passes.
The earliest help red and historical ticket-50 red do not have complete original
runtime archives; no stronger identity claim is made. Final candidate archives
and exact passing inventories are retained. Historical ticket-50/51/52 reports
remain development evidence, and pinned Graphite parity research remains baseline
research rather than newly passing implementation acceptance.

No full repository suite, full CI matrix, other-platform native/release matrix,
benchmark, live GitHub mutation test, npm publication, release, global user
installation or MCP client configuration change was run. The existing cheap
npm-test caller adds scenario 17; no CI workflow was changed. Recovery retains
Anthracite's immediate nonzero conflict outcome, strict mandatory frozen/worktree
protection and bounded raw-abort semantics. A local acceptance result does not
claim transactional rollback for arbitrary external hooks/ref races.
