# Sync local-restack recognition: baseline investigation

## Version and boundary

Observed on 11 November 2026 with the published npm 0.7.0 CLI, source `4fc0fa51a3f374c4346842d27aa0daee82baf3dc`, on macOS ARM64 and Node 24.19.0. The [baseline runtime receipt](sync-local-restack-evidence-2026-11-11/baseline-runtime.json) verifies the actual installed CLI bytes against the retained public tarball and links its earlier signature/provenance proof. Public CLI processes used existing real-Git/bare-remote fixtures and a controlled gh executable. No live GitHub writes, user-project reads/writes, installation changes or CI occurred in this synthetic campaign. Earlier read-only diagnosis of the user's reported repository is separate and its private content is not included here.

## Reproduction

A minimal selected graph contains one published tracked branch on main. Advance remote main independently, then run sync without cleanup. It fast-forwards trunk and restacks the branch locally. The remote branch remains unchanged. A second sync enters the generic same-parent overwrite/rebase menu despite an equal branch patch. Selecting Abort preserves observed local refs, checkout, index/files and recovery. The [original capture](sync-local-restack-evidence-2026-11-11/raw/reproduction.json) retains both outputs and boundaries.

The baseline red-capable command is the retained reproduction probe with its explanatory-message assertion enabled. It reports exact menu reproduced, equal patches, preserving abort and missing restack explanation, then fails that assertion. The [probe instructions](sync-local-restack-evidence-2026-11-11/README.md) identify its exact public artifact and isolated output settings.

## Public CLI comparisons

| Synthetic state | npm 0.7.0 outcome | Important observation |
| --- | --- | --- |
| Unchanged branch | Success; no reconciliation menu | Control. |
| Incoming remote fast-forward | Success; no reconciliation menu | Control. |
| Ordinary unpublished local commit | Same-parent menu | Even ancestry-contained remote work receives the generic reconciliation choice. |
| Equivalent local restack | Same-parent menu | Patch IDs and branch-owned aggregate diffs match. |
| Restack plus local content change | Same-parent menu | Real local difference must remain protected. |
| Restack plus amended message | Same-parent menu | Patch IDs and aggregate diffs still match; complete message differs. |
| Restack plus whitespace change | Same-parent menu | Stable patch IDs match while exact patch bytes differ. |
| Restack followed by incoming remote commit | Same-parent menu | New remote work must not be silently ignored. |
| Reordered independent local commits | Same-parent menu | Aggregate branch diff matches while commit sequence differs. |

All nine observations are retained in the [unchanged CLI capture](sync-local-restack-evidence-2026-11-11/raw/cli-comparisons.json). The seven prompted cases verified preserving abort. These are baseline observations, not nine passing tests of the proposed behavior.

## Recognition constraints

The existing remote-update preparation detects a local head that cannot fast-forward to its selected source and routes it to the same-parent resolution menu. It does not distinguish ordinary local-ahead work from a rewritten equivalent history. The existing narrow merged-parent/local-ahead survivor repair remains a separate protected case.

Examined branch metadata contains the parent name/revision, frozen status and PR information, without a dedicated last-published head. A current remote observation is not proof of who performed a past rewrite. Reflog text is not proposed as durable authority.

A conservative read-only diagnostic prototype compared ordered branch-owned commits above validated parent boundaries, including author/message and exact patches. It recognized the pure restack while rejecting the negative examples in the five-case campaign. A subsequent raw-byte refinement retained trailing whitespace and message bytes without output trimming; its two captures distinguish a pure restack from a trailing-space-before-newline edit even when stable patch IDs agree. The [initial diagnostic](sync-local-restack-evidence-2026-11-11/raw/strict-comparisons.json) and [raw-byte refinement](sync-local-restack-evidence-2026-11-11/raw/raw-strict-comparisons.json) are separate historical campaigns.

The [two-branch probe](sync-local-restack-evidence-2026-11-11/raw/stack-proof.json) establishes equivalent own commits for both parent and child using paired remote/local parent heads. Ordinary ancestry between the old and rewritten parent heads fails even though the child restack matches. A recognition implementation must therefore validate dependencies rather than repeatedly comparing a child's old/new bases as if they were fast-forwards.

## Limits and next step

The prototype is deliberately conservative. Exact diff comparison can refuse a valid replay after contextual/base changes. Unsupported merges, encodings, missing evidence or differing history must remain explicit uncertainty; patch/tree matching alone cannot authorize overwriting or skipping source changes. The campaign does not establish candidate/native/MCP acceptance, performance on large histories, every file/commit shape or recovery compatibility. Initial probe development also needed to fetch newly created fixture objects before comparing them; the final probe does so explicitly.

The [approved specification](../specs/sync-local-restack.md) adds fresh authority, graph integration, option/protection, conflict/continuation and delivery acceptance. It keeps sync publication-free and get semantics unchanged. No production implementation is included in this research/specification branch.
