# Practical absorb comparison — 29 October 2026

## Result

Graphite 1.8.6 distributes staged text edits into earlier feature commits and restacks descendants while the caller remains on the top branch. Installed npm Anthracite 0.2.1 rejects `absorb`, including a bare invocation without optional flags, through the actual Codex MCP connection. The missing feature is automatic hunk-to-commit selection and its execution/preview interface; amendment and restacking already exist separately in Anthracite.

This is a bounded demonstration and research record, not an implementation specification or complete parity certification. No product code or existing feature branch was rewritten, and no live PR, package installation, release or CI workflow was changed. The report and selected evidence are published on a documentation branch only.

## Five paired real-Git cases

Each CLI starts with the same commits and file contents in its own synthetic repository, with no Git remote:

```text
main → refactor [Introduce helper] → api [Introduce API] → tests [Add tests] ← HEAD
  └── other [unrelated work]
```

Graphite receives `absorb --dry-run --no-interactive`, then `absorb --force --no-interactive`. Anthracite receives the latter arguments through MCP with an explicit fixture cwd. Independent Git observations check refs, commit trees/subjects, index, working files and branch topology; the occupied case also checks the other worktree.

| Case | Graphite result | Anthracite result |
| --- | --- | --- |
| One helper edit | Exit 0. Amends the original `refactor` commit; replays `api` and `tests`. The final tip contains exactly the initial working files and the index is clean. | Exit 1, unsupported command/flag; observed snapshot unchanged. |
| Helper and API edits | Exit 0. Places each edit in its respective feature commit and restacks `tests`. Commit subjects and logical branch chain remain intact. | Same refusal and unchanged snapshot. |
| No clear target | Exit 0. Absorbs the helper edit but leaves the trunk-owned README edit and a newly staged file staged. The new file is omitted from the preview and from the printed count of unabsorbed changes. | Same refusal and unchanged snapshot. |
| Frozen `refactor` | Exit 0. Excludes the helper edit, keeps the frozen target unchanged, applies the API edit and restacks `tests`. The helper edit remains staged. | Same refusal; this does not exercise an Anthracite absorb-specific frozen guard. |
| `refactor` checked out in another worktree | Dry-run proposes both destinations. Apply exits 1 when Git rejects `branch -f refactor` with exit 128. No branch-ref, staging or worktree-content changes were observed during apply; its complete captured snapshot equals the post-dry-run snapshot. | Same refusal; this does not exercise an Anthracite absorb-specific worktree guard. |

In every case, both CLIs retain the current `tests` checkout and working-file bytes, and leave trunk and the unrelated branch unchanged. Graphite's dry-run preserves logical Git state but changes raw index bytes in all five cases and captured metadata in four. It is therefore not a byte-for-byte read-only operation. Apply-time refusal in the occupied case must not be generalized into universal rollback or early participant validation.

The no-clear-target fixture tests a trunk-owned line untouched by feature history. It does **not** establish behavior when multiple candidate commits might plausibly own the same hunk.

## What Anthracite still needs

The [registered command list](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/command_modules.ts#L50-L95) contains no absorb route. The installed parser confirms this independently with `Unknown argument: absorb`. Its [modify handler](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/commands/modify.ts#L68-L115) and [amend action](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/actions/commit_amend.ts#L19-L51) amend the current commit and restack descendants; they do not select different earlier commits for separate staged hunks.

A next specification can bound the work to target selection, an accurate preview, application with explicit leftovers, frozen/worktree participant rules and truthful continuation after failure. Existing [worktree protection](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/lib/git/worktrees.ts#L5-L19), [frozen guards](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/lib/engine/frozen_branch.ts#L5-L10) and [restack continuation](https://github.com/danielbaars/anthracite/blob/966877d4c382560c58d31a3ea9623705c57dbb83/apps/cli/src/actions/restack.ts#L69-L154) are possible building blocks, not proof that the new workflow already works. General undo need not become an implicit prerequisite.

## Evidence and limits

- [Artifact identities](../verification/evidence/absorb-demo-2026-10-29/identities.json) pin Graphite 1.8.6, npm Anthracite 0.2.1, Node 24.19.0 and source commit `966877d4c382560c58d31a3ea9623705c57dbb83`; executable digests still match after capture.
- [Complete captures](../verification/evidence/absorb-demo-2026-10-29/captures.json) retain ten Graphite REA process captures, five Anthracite MCP refusals and the additional bare-command refusal. REA 6.7.0 runs Graphite under a PTY without input events, using `env -i`, explicit isolated HOME/configuration and gh/editor/pager sentinels. None of those sentinel tools was called. Terminal captures are not truncated. These respective PTY and MCP observations do not certify every transport combination.
- [Validation](../verification/evidence/absorb-demo-2026-10-29/validation.json) reports 71 passing outcome predicates across **five paired cases**. This means neither 71 independent test scenarios nor 71 features. Before/post-dry/post-apply observations distinguish raw persistence changes from logical Git changes.

REA process observation includes unverified system-process samples where platform-binary environment information was withheld. A targeted follow-up found four sampled processes gone and one Metal system service; no sampled process was killed. Neither these samples, isolated credentials nor absence of Git remotes proves complete process or network containment.

The official [command reference](https://graphite.com/docs/command-reference#gt-absorb) documents staged-hunk assignment, preview/force and staging options. The [mid-stack tutorial](https://graphite.com/docs/update-mid-stack-branches#absorbing-changes-into-your-stack) explains commuting changes through history; the [worktree guide](https://graphite.com/docs/multiple-worktrees) gives general protection rules. Absorb-specific frozen/worktree results above are measured rather than inferred from those general descriptions.

Still untested: genuinely competing commit candidates, complex same-file hunks, multiple commits per branch, conflicts/hooks/recovery, interruption, `--all`, `--patch`, aliases, interactive confirmation and general rollback. These remain specification questions; this report creates no implementation commitment.

To recheck retained observations, run `python3 docs/verification/evidence/absorb-demo-2026-10-29/verify_states.py`. The [fixture builder](../verification/evidence/absorb-demo-2026-10-29/fixture.py) records the original absolute scratch root and tool paths; an execution replay requires an absent root (or an explicitly selected new root in a copy) and the pinned tools. `captures.json` retains the complete inline REA Evidence records for these ten observations; the unfiltered session export is not part of the selected publication. The [file manifest](../verification/evidence/absorb-demo-2026-10-29/manifest.json) defines the retained subset.
