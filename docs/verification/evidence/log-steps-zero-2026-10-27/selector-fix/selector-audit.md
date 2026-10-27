# Existing PTY branch-selector ordinal audit

Read-only source audit at Anthracite `f89ef82f`. No source/test edits, new CI actions, live probes or reproduced failures were performed by this audit. Parent-provided CI evidence identifies a real wrong-target failure in the leaf-only move-selector scenario; the other entries below distinguish related source risk from proven failure.

## Fixed ordinal coupled to a fixed branch identity

All matches are in the file already assigned to the selector-fix implementer:

| Existing case | Input / assertion pointers | Intended target | Assessment |
| --- | --- | --- | --- |
| `move_selector_cli.test.ts`:43, selects an explicit source target | Up+Enter at50; parent/head assertions56–62 | `other` | Same incidental ordinal-selection pattern; not a test of keyboard ordering. This audit did not reproduce its failure independently. |
| `move_selector_cli.test.ts`:88, selects a leaf-only target from a different departure | Up+Enter at97; ancestry and navigation104–107 | `other` | Actual CI failure supplied by parent: resulting parent main instead of other. |
| `move_selector_cli.test.ts`:110, uses the current source without an explicit source option | Up+Enter at115; ancestry/navigation119–121 | `other` | Same incidental ordinal-selection pattern; no independent failure claimed here. |

The semantic intent of these three tests is selecting `other` while retaining source-aware filtering, checkout behavior and ancestry. Selecting by literal `other`, then waiting for the completed filtered suggestion before Enter, fits that existing intent and removes incidental graph-position dependence. Keep all existing ancestry/ref/checkout assertions. A fixture with tied feature dates and newer trunk can exercise changed ordinal positions without changing production ordering.

No further branch-selector case was found that sends a fixed arrow count and then requires a fixed named branch. Search covered `.ts` tests under `apps/cli/test`, including both `\\u001b[A/B` and `\\x1b[A/B` forms.

## Deliberate arrow-navigation test: retain

`reorder_stack_selector_cli.test.ts`:419–447 is explicitly named “uses actual arrow keys to choose a different tip than the initial terminal suggestion.” It waits for an initially rendered suggestion, sends Up, waits for another rendered response, then confirms. It derives the initial `tip|deep` suggestion from the transcript at432–434 and asserts the opposite chosen chain at439–444. It does **not** assume that a fixed ordinal always names one branch. Replacing this with a name filter would remove the intended keyboard-navigation coverage.

## Non-targeted branch-selector refusal: no demonstrated reason to rewrite

`freeze_structural_routes_cli.test.ts`:287–312 opens move selection, freezes the source through another public CLI process in `beforeInput`, then sends Up+Enter at296. Assertions require frozen-source refusal and preserved refs/index/checkout, independent of which valid destination was selected. It is not an assertion that Up names a fixed branch. No additional failure was demonstrated by this audit.

## Other arrow matches are different public interfaces

These are not branch sibling-order selectors and are not justified blanket rewrite candidates:

- `modern_alias_compatibility_cli.test.ts`:155–156 and `frozen_local_writes_cli.test.ts`:201/205/400/650/654: split commit-boundary selection on known linear commit history, followed by branch-name text prompts. Retain public commit navigation assertions; this audit found no branch-date ordinal dependency.
- `interaction_submit_cli.test.ts`:436: PR body-template choice, with expected template derived from the actual offered order at440–450, rather than a fixed branch identity.
- `get_import_defaults_cli.test.ts`:473 and `interaction_defaults_cli.test.ts`:479: a fixed semantic conflict-resolution menu, not graph branch ordering.
- `frozen_submit_cli.test.ts`:1012: fixed submit decision menu plus an intervening freeze, not branch ordering.

## Why completed acknowledgement matters for name-filter selection

- `apps/cli/src/actions/log.ts`:75–132 builds choices from the shared graph, filters allowed/omitted identities, and chooses `initial` by current/initial branch. The ordinary graph order originates from the engine’s sorted branch names; `apps/cli/src/lib/git/sorted_branch_names.ts`:10 uses committer-date sorting. Tests whose intent is branch identity should not infer that identity from one arrow relative to an incidental ordinal.
- `apps/cli/src/lib/utils/prompts_helpers.ts`:11–19 returns a Promise of case-insensitive substring-filtered choice values.
- `node_modules/prompts/lib/elements/autocomplete.js`:78–92 awaits completion, installs suggestions and updates selected value before invoking its render callback. Typing the filter and Enter together can therefore confirm the previous selected value before asynchronous filtering finishes.
- `apps/cli/test/lib/utils/run_cli_in_pty.ts`:23–36 matches observed prompt bytes with a moving response offset and immediately writes each queued input. Waiting only for the typed-query render acknowledges the input text; waiting for the completed filtered-suggestion render acknowledges the selection to be confirmed. The corrected move-rotation precedent is `move_rotation_cli.test.ts`:203–206, with a complete `› tip\\r\\n❯` acknowledgement before Enter.

The same missing completion acknowledgement may be a general test-driver risk in other name-filter cases, but this audit does **not** claim new production defects or new failures in them. Parent-assigned source/time fixes and the three ordinal move-selector cases are the bounded, evidence-supported correction scope. Do not rewrite every existing name-filter test without a reproduction or a directly demonstrated shared failure.
