# Draft contract consistency check

Read-only check of `publication/docs/specs/split-by-file.md`, 28 October 2026, against the six approved groups and inspected source/recovery facts. No runtime checks, canonical edits or expanded review workflow.

## Concrete clarifications

1. **Partial file/directory replacement can have no representable projected tree (decisions 3–4, lines 94–96).** Example: parent contains `d/a`, source replaces the directory with blob `d`; selecting only the addition of `d` while leaving deletion of `d/a` unselected requires impossible simultaneous blob `d` and tree `d/`. Both entries are ordinary supported Git entries, so “unsupported Git entry” does not clearly govern this combination. Add a bounded early refusal for structurally unrepresentable selected projections, telling the caller to select the dependent paths together. Never silently enlarge selection. This needs no new path framework or broad matrix.

2. **Name-collision acceptance is weaker than its implementation decision (T5 line 132 versus decision 7 line 102).** Decision 7 requires the first available repeated `_split` candidate; T5 currently allows safe failure even when a later valid candidate exists. Require successful suffix allocation for ordinary exact-name/ref-namespace collisions when a candidate exists, and reserve early failure for genuinely unavailable/invalid allocation. Otherwise an implementation that always refuses collisions can pass T5 while violating the agreed Graphite naming behavior.

## Consistent and covered

- All six groups are represented: T1–T2 exact trees/history/descendants; T3–T4 aliases/repetition/literal/cwd/Unicode/add/change/delete/rename/binary/modes; T5–T6 names/messages/local PR/no-match/all-selected; T7–T10 source/options/dirt/untracked/ignored/frozen/worktrees; T11–T13 chain/fanout/genuine conflict/hook failure/fresh continuation; T14–T15 no-UI/quiet/help/completion/commit-hunk regression/existing MCP smoke.
- Source eligibility deliberately requires a restacked current source while permitting valid stale descendants. This agrees with inspected metadata validity and recorded-base replay. T12 explicitly creates that state; it does not imply an ordinary unchanged-tree child can naturally conflict.
- Source-tree retention is unconditional for ordinary successful execution; old descendant-tree retention is correctly limited to initially restacked nonconflicting descendants. Explicit stale-child resolution is separately asserted.
- Zero/all-selected requests refuse early; original name/local PR identity remain; all-selected deletion and occupied-child skip are accurately identified as deliberate differences from the coordinator-reported Graphite probes.
- Read-only preflight before context repair/hooks, raw-index/opaque-state refusal preservation, preconstruction validation, and bounded post-hook effects are separated. Construction/prepublication failures do not claim general rollback. Partial publication is allowed only as reported reached state, not completed success.
- Existing queue/base/ownership/return mechanisms are reused; a minimal durable split role is permitted so mandatory protection survives fresh continuation. Actual active-rebase continue is distinguished from manual restack recovery when no rebase exists. Staged resolution survives refusal; raw abort is explicitly bounded.
- No new MCP tool/harness, engine-mock framework, universal undo, journal redesign, live PR fixture or full CI matrix is required. Imported storage/continuation compatibility and foreign lock preservation remain explicit.

## Small boundary to keep explicit during implementation

The source's own history is restricted to linear commits; descendant replay remains the existing restack mechanism. Do not interpret “keep descendants' own messages” as a new promise to preserve merge topology or arbitrary commit identity. Existing `git/rebase.ts` uses ordinary rebase without `--rebase-merges`. The current approved fixtures exercise linear descendants; broader merge replay certification is unnecessary for this slice.
