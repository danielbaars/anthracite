# Graphite parity register — Anthracite 0.4.0

Reconciled on **30 October 2026** against released [v0.4.0](https://github.com/danielbaars/anthracite/releases/tag/v0.4.0), commit `9c173deb652509ca55ba9104b1254705b439d396`. The measured Graphite reference remains **1.8.6**. This is the current index of shipped work, known interface gaps, deliberate differences and unanswered comparisons. It is not a new paired runtime audit or a percentage of Graphite functionality.

Use [the command reference](../DOCUMENTATION.md) for supported arguments, [compatibility](../COMPATIBILITY.md) for retained behavior, and the linked acceptance records for their exact source, runtime and scope. A test file or advertised Graphite flag alone does not prove a working workflow. Historical counts are not added together or relabeled as tests of 0.4.0.

## Scope and evidence

The goal is a standalone local stacked-Git CLI, with optional direct GitHub workflows and local MCP. Graphite accounts and hosted services are not prerequisites. Existing Charcoal metadata and interrupted operations remain compatible; product names and retained legacy settings are deliberate choices.

This reconciliation checked the 0.4.0 command registrations/builders, raw-Git allowlist, single-trunk configuration and current documentation against retained research and delivery records. Two isolated public npm CLI marker probes also rechecked B01 below. The [original comparison](https://github.com/danielbaars/dinky-misc/blob/9ddc0155f4bcfba548dc6dc82dde9398994fe2b1/research/graphite-charcoal-feature-parity-2026-10-21.md) describes an older Charcoal baseline; its missing features must not be copied into today's backlog without reconciliation.

**Shipped** below means available in the release within a documented contract. **Interface gap** means the named command or option is absent/different in current registration; it does not prove the end state is impossible using another workflow. **Unverified** is not a bug. No new Graphite probe, live GitHub fixture, full suite or CI matrix was run to create this register.

## Shipped work

| ID | Area available in 0.4.0 | Evidence and boundary |
| --- | --- | --- |
| S01 | Local stack creation/mutation: `create --onto`, `move --onto/--only`, `fold --stack`, `reorder --stack`, restack and fresh continuation | [Command reference](../DOCUMENTATION.md), [compatibility](../COMPATIBILITY.md). These have bounded input, participant, worktree and recovery contracts; not universal rollback or every modern Graphite mode. |
| S02 | Modern command names/fixed aliases, parent/children, selected `info`/stat, global cwd and interaction policy | [Supported routes](../COMPATIBILITY.md#supported-short-forms). Direct children in `info` were repaired in [PR #28](https://github.com/danielbaars/anthracite/pull/28). Fixed aliases do not implement configurable aliases. |
| S03 | Freeze/unfreeze, mandatory-participant guards, retained status and new-get author defaults | [Frozen contract](../COMPATIBILITY.md#frozen-branch-compatibility), [command reference](../DOCUMENTATION.md#frozen-branch-status). Imported unknown/other authors are frozen; generic skip behavior and structural mandatory refusal are distinct. |
| S04 | Current-branch zero-depth inspection and bounded single-trunk full/short/long presentation | [Zero-depth acceptance](verification/log-steps-zero-2026-10-27.md), [presentation acceptance](verification/log-presentation-parity-2026-10-27.md), PRs [#6](https://github.com/danielbaars/anthracite/pull/6) and [#11](https://github.com/danielbaars/anthracite/pull/11). Remaining log work is G05/G09 and U02 below. |
| S05 | Local stdio MCP: `learn_an`, `run_an_cmd`, same-build execution, limits/cancellation and recovery across sessions | [User guide](mcp.md), [acceptance](verification/mcp-support-implementation-2026-10-27.md), [PR #19](https://github.com/danielbaars/anthracite/pull/19). No new Graphite login, HTTP service or publication authority. |
| S06 | Noninteractive `split --by-file` with literal argument delivery, pathspec selection and mandatory descendant recovery | [User guide](split.md), [acceptance](verification/split-by-file-implementation-2026-10-28.md), [PR #27](https://github.com/danielbaars/anthracite/pull/27). Existing interactive commit/hunk modes remain; not every possible split mode. |
| S07 | GitHub submit/get/sync workflows; additive reviewers/assignees with `--roles-branch` targeting | [Submission guide](submit.md), [roles acceptance](verification/submit-pr-roles-implementation-2026-10-28.md), [review fixes](verification/submit-pr-roles-review-fixes-2026-10-28.md), [PR #34](https://github.com/danielbaars/anthracite/pull/34). Role scope is separate from submission scope. Controlled adapters and bounded live workflows do not certify every authenticated service combination. |
| S08 | `absorb`/`ab`: staged text correction, previews, tracked-only all/terminal patch modes, mandatory replay and retained-input recovery | [Contract](specs/absorb.md), [acceptance](verification/absorb-implementation-2026-10-29.md), [PR #47](https://github.com/danielbaars/anthracite/pull/47). Unsupported entries remain explicit leftovers or documented early refusals. |
| S09 | Targeted insertion: terminal child selection and repeated literal `--insert-child`; selected-scope replay/continuation | [User guide](targeted-insertion.md), [acceptance and warning follow-up](verification/create-insert-child-selection-2026-10-29.md), [PR #54](https://github.com/danielbaars/anthracite/pull/54). Selection precedes mutation. Noninteractive omission still selects all children; multi-child omission warns even with quiet. The explicit selector is an Anthracite extension, not a measured Graphite flag. |
| S10 | Public npm distribution with both `an` and `anthracite`, Node 24+, OIDC/provenance and isolated package checks | [Release operations](npm-release.md), [0.4.0 release](https://github.com/danielbaars/anthracite/releases/tag/v0.4.0), [successful release run](https://github.com/danielbaars/anthracite/actions/runs/41017154452). This is distribution evidence, not additional Git-semantic parity. It does not assert matching standalone assets for every npm version. |

## Open functionality and decisions

These are source/interface gaps and bounded candidates, not newly reproduced defects or approved implementation specifications. The earlier priority remains: explore useful direct GitHub review/merge workflows before the lower-priority mode/configuration/recovery extensions. Existing supported recovery correctness remains mandatory regardless of priority.

| ID | Remaining item | Status and next action |
| --- | --- | --- |
| G01 | Dedicated PR opening/review and stack-aware merge workflows | **Implemented in the candidate; not released in 0.4.0; tracked in [#57](https://github.com/danielbaars/anthracite/issues/57).** The candidate implements the approved [PR review and stack landing specification](specs/pr-review-stack-landing.md) with direct-GitHub `pr`, head-bound single-PR `review` and scoped rebase-only `land`, preserving raw Git `merge`. See the [design/evidence limits](verification/pr-review-stack-landing-spec-2026-10-30.md). No new Graphite runtime or live GitHub review/merge acceptance is claimed. |
| G02 | Anthracite `abort` | No dedicated handler. Raw `an rebase --abort` cancels its active Git rebase, retaining earlier completed work/parent changes. Compare representative operation recovery before specifying an operation-aware abort; do not promise whole-operation rollback. |
| G03 | Anthracite `undo` | No dedicated handler or general undo contract. Research snapshot coverage, local work, PR effects and failure limits before implementation. Git reflog availability is not equivalent feature acceptance. |
| G04 | `unlink`: remove PR association without untracking the branch | No public route. An internal `clearPrInfo` primitive is not a complete user workflow; `untrack` changes tracking and is not a substitute. Measure the intended association-only contract. |
| G05 | Multiple trunks and a `trunk` management/query interface | [Repository configuration](https://github.com/danielbaars/anthracite/blob/v0.4.0/apps/cli/src/lib/spiffy/repo_config_spf.ts) has one trunk. [#12 L1](https://github.com/danielbaars/anthracite/issues/12) tracks the log consequence. A broader engine/domain decision must precede all-trunk display or mutation options. Deferred. |
| G06 | Central `config` UI and user-configurable aliases | Existing `repo`/`user` settings and fixed aliases work. They are not Graphite's central UI/alias-file mechanism. Deferred; preserve existing configuration/alias meanings. |
| G07 | Additional modes on existing commands | The source-checked examples below lack their named Graphite spelling. Establish equivalent/alternative behavior per mode before adding flags; core commands and already shipped flags are not missing. Lower priority. |
| G08 | Stack-aware/trunk-revert workflow | `an revert` is a raw Git passthrough, not Graphite's advertised branch-producing workflow. A candidate for comparison, without an agreed Anthracite contract. Preserve raw Git compatibility. |
| G09 | Historical `--classic` sibling/traversal order | [#12 L2](https://github.com/danielbaars/anthracite/issues/12) remains deferred. Exact Graphite order would need information Anthracite does not retain; decide whether to implement it or accept a lasting difference. Ordinary full/short ordering was already addressed. |

### G07: source-checked option examples

These examples reconcile advertised Graphite 1.8.6 interfaces with the released builders and globals, not fresh runtime comparisons. Similar flags, Git passthroughs and alternative commands can overlap their purpose. This is not an exhaustive option matrix.

| Current command | Named interface still absent | Current capability retained |
| --- | --- | --- |
| `create` | `--update`, `--verbose`, `--ai` | Onto, staged/all/patch input, insertion and explicit child selection. AI service parity is outside scope. |
| `modify` | `--into`, `--update`, `--reset-author`, `--verbose` | Amend/commit, explicit editor/message and interactive rebase. |
| `move`, `fold` | `move --all`, `fold --close` | Move onto/source/only and fold stack/keep. |
| `checkout`, `up` | Checkout `--all/--stack/--trunk`; up `--to` | Explicit branch, untracked selection and step-based navigation. |
| `delete` | `--close`, `--downstack`, `--upstack` | Selected local deletion with force/protection rules. |
| `sync` | `--all`, `--delete-all` | Existing pull/delete/force/restack controls; feature-head updates use get. |
| `get` | `--downstack`, `--remote-upstack`, `--restack`, `--checkout`, `--delete-all` | Existing target/force and **shipped** `--unfrozen/-U` import defaults. |
| `submit` | Automatic-restack and additional metadata/review modes beyond current registered options | Existing selection, draft/publish, previews, role targeting and safe repetition. Team reviewers and assignees are already supported, not new gaps. Backend-dependent proposals require a separate scope decision. |

## Deliberate retained differences

| ID | Decision retained in 0.4.0 |
| --- | --- |
| D01 | Refuse protected mandatory structural participants before parent changes rather than reparenting and skipping their required replay. Generic frozen restack skips remain a different contract. |
| D02 | Genuine replay conflict returns nonzero with truthful retained-state/continue guidance. Do not copy the measured Graphite insert success-with-deferred-restack policy as an incidental parity fix. |
| D03 | Select insertion children before staging/creation. Noninteractive omission retains all-children compatibility; the warning is not confirmation or prevention. Explicit child values are the agent-safe scope choice. |
| D04 | Retain `an`/`anthracite`, Charcoal metadata compatibility, `CH_EDITOR`/`CH_PAGER`, fixed legacy aliases and short-only log `-c`. GitHub auth uses `gh`, not Graphite activation/token input. |
| D05 | Keep correct current-only zero-depth selection and suppress connectors to hidden descendants. Do not reproduce the measured Graphite dangling connectors. |
| D06 | Quiet disables Anthracite prompts/editors/pagers under its effective interaction policy. Raw Git `merge`, `revert` and `mv` keep Git meanings; a future feature must not silently reinterpret them. |

## Unverified comparisons and coverage limits

| ID | Open question, not an established defect | Required evidence before changing status |
| --- | --- | --- |
| U01 | Advanced get/submit/sync and authenticated PR/status/review behavior beyond retained fixtures | Paired relevant scenarios with explicit service/auth scope. Controlled adapters, existing GitHub smoke tests and one successful workflow do not cover every combination. |
| U02 | Log order outside retained graphs, service badges, general wrapping/themes and ambiguous worktree basenames | Concrete paired counterexamples; preserve [#12 U1–U3](https://github.com/danielbaars/anthracite/issues/12). These are not three confirmed renderer bugs. |
| U03 | Full interactive Fish behavior and broader platform/runtime coverage | Actual supported-shell/platform evidence. Generated Fish content, macOS ARM64 native checks and Linux Node CI are different coverage; none proves Windows MCP process supervision or all standalone release assets. |
| U04 | Remaining historical Graphite entry points such as `guide`, `state`, `list-repositories` and `upgrade` | Determine public/support status, standalone value and service dependence before classifying them as required features. npm installation already supplies an upgrade route; a missing identical command is not proof that upgrades are impossible. |

The reference is pinned to Graphite 1.8.6. Newer Graphite changes need a new comparison, not an assumption that this register covers them.

## Anthracite maintenance, separate from parity

| ID | Confirmed current issue | Evidence and next action |
| --- | --- | --- |
| B01 | `test --upstack/--downstack` executes the whole stack instead of the requested subset | Both isolated 0.4.0 [marker probes](verification/evidence/parity-register-0.4.0/README.md) ran on base, child and tip from child, rather than child/tip or base/child. The [action](https://github.com/danielbaars/anthracite/blob/v0.4.0/apps/cli/src/actions/test.ts) ignores the parsed scope and uses `SCOPE.STACK`. Do not rely on those flags to bound execution. Repair and regress this separately; it is an Anthracite bug, not a missing Graphite feature. |

The old `info` child-list defect is already resolved by S02/PR #28. Historical source-only suspicions such as existing-PR title propagation have not become current confirmed bugs; require a focused reproduction before opening them as defects. B01's two observations establish failures, not passing feature-acceptance cases or a new audit of the rest of `test`.

## Outside the parity goal

- **X01 — Graphite hosted platform:** account/backend emulation, web-submit, repository indexing, Chat, AI Reviews, hosted agents, platform automation and merge queue are excluded, not a later implementation phase. Direct GitHub workflows remain the separate optional G01 track.
- **X02 — Graphite credential/feedback services:** no Graphite activation-token transport or Graphite message-submission backend. Local `feedback debug-context` and `gh` authentication retain their current meanings.
- **X03 — Blind bug compatibility:** observed unsafe protection changes, hidden-descendant connectors and success statuses for incomplete replay are not requirements. Keep accepted Anthracite behavior unless an explicit decision changes it.

## Tracking and next work

The original reconciliation recorded [#12](https://github.com/danielbaars/anthracite/issues/12) as the only open issue; its L1/L2 remain deferred. The subsequent approved G01 specification is now tracked in [#57](https://github.com/danielbaars/anthracite/issues/57). Closed MCP, split, roles, absorb and insert issues are shipped work, not still-open tasks. This document closes no issues and does not resume the log backlog.

Keep the IDs stable. When implementing or deciding an item, link its issue/specification, merged source/release and exact bounded evidence; move it to shipped, deliberately retained or excluded status rather than deleting it. Split interface findings from runtime defects. Keep #12 open until its existing tracking rule is satisfied. Do not turn a related documentation PR into a closing reference for that backlog.

G01 now has a candidate implementation of its approved [full specification](specs/pr-review-stack-landing.md), with public-CLI/real-Git/controlled-gh acceptance and a separately authorized later live smoke. This candidate is not a claim that 0.4.0 shipped the workflow or a successful Graphite runtime comparison. B01 is separate maintenance to address before relying on its scope selectors. The remaining entries are not implementation approval. No new live-service tests, full suite, CI matrix, release assets or installation changes are authorized by this register.
