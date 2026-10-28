# Practical file-split comparison — 28 October 2026

## Result

Graphite 1.8.6 successfully extracts selected files from a mixed feature commit into a new parent branch without interaction. Installed Anthracite `0.1.1-dev.20261027211215` rejects the same file-split flag through its real MCP tool. The missing functionality is a native noninteractive file-split route; Anthracite already has other split and restack machinery.

This is a practical demonstration, not an implementation specification or exhaustive safety certification. No product code, live PR, release, global installation or CI workflow was changed or started.

## Demonstration

Both tools start with independently prepared repositories containing exactly the same Git commits and working files:

```text
main ── feature [refactor + API + test changes] ── child [follow-up documentation]
  └──── other [unrelated work]
```

The single feature commit changes `src/refactor/utils.ts`, adds `src/refactor/new-helper.ts`, and changes `src/api/service.ts` and `tests/api.test.ts`. The child adds `docs/follow-up.md`. There is no remote.

Graphite invocation (the wildcard is passed as one literal argument, without shell expansion):

```sh
gt split --by-file 'src/refactor/**' --no-interactive
```

Observed exit 0, with no input events or editor/gh/pager sentinel calls:

```text
Creating branch feature_split
Restacked child on feature.
```

Independent Git observations establish this result:

```text
main ── feature_split [the two refactor-file changes]
              └── feature [API + test changes] ── child [follow-up documentation]
  └──── other [unchanged]
```

| Observation | Before | After Graphite |
| --- | --- | --- |
| Current branch | `feature` | `feature` |
| Extracted parent | Absent | `feature_split`, directly above `main` |
| Selected changes | Included in the mixed feature commit | Exactly the two refactor-file changes in the new parent's tree delta |
| Remaining feature delta | Refactor + API + tests | Only `src/api/service.ts` and `tests/api.test.ts` |
| Feature final tree | Original tree | Exactly the same Git tree |
| Child final tree | Original tree | Exactly the same Git tree; rebased onto rewritten feature |
| Main and unrelated other branch | Original tips/trees | Unchanged |
| Commit subjects | `Add endpoint and refactor helper` | That subject is reused for both split commits |
| Working tree and staging | Clean | Clean |

Commit identities necessarily change: feature `737d46d` becomes `bc2c630`, the new parent is `38b58e6`, and child becomes `b8389db`. This is content preservation, not preservation of the original commit IDs. Logical descendant behavior in this fixture agrees with the independently observed Git ancestry.

Anthracite was invoked through the actual `run_an_cmd` MCP tool with the same arguments and its separate fixture cwd. The following shows the request shape with an abbreviated cwd and explanation:

```json
{"args":["split","--by-file","src/refactor/**","--no-interactive"],"cwd":"/absolute/isolated/fixture/repo","why":"Compare file splitting in an isolated synthetic stack"}
```

It returns MCP `isError: true` and the normal CLI failure:

```json
{"status":"cli_error","stdout":"","stderr":"Unknown arguments: by-file, byFile\n","exitCode":1,"signal":null,"truncated":false}
```

No branch is created. The complete observed Anthracite before/after snapshot is identical, including refs, raw index hash, working files, staged/unstaged output and captured repository metadata. The other two Anthracite refusals preserve those snapshots too.

## Two bounded additional controls

| Fixture | Graphite 1.8.6 | Anthracite |
| --- | --- | --- |
| No matching path, `does-not-exist/**` | Exit 1, reports that no new branch was created and Git pathspec did not match. Branch refs, file contents and staged/unstaged state remain unchanged. **Raw index bytes and internal metadata do change**; this is not a byte-for-byte no-effect guarantee. | Same unsupported-flag refusal; observed snapshot identical. |
| An unstaged tracked API edit plus an untracked note | Exit 1: `This command cannot be run with uncommitted changes.` Refuses the operation and preserves branch/file/staging state. The initial REA capture had a cleanup-verification error; a fresh direct-subprocess fixture independently confirms exit 1 and preservation. | Same unsupported-flag refusal; dirty snapshot identical. This does not prove a file-mode dirty guard because no such mode exists. |

## Evidence, identities and method

The [identity record](../verification/evidence/split-by-file-demo-2026-10-28/identities.json) pins Graphite 1.8.6 SHA-256 `9153b4b6d9ad8084ec700a1fb80dd8a4b35c08c3116bf41f1fcdd792b326781f` and the installed Anthracite binary SHA-256 `3042f6c7dfee0f4c4a26ed9056a6405dc6e00dd844488d04dfe883f91bd580d9`. Anthracite source baseline is `3923b1088b29f02ce9d9e2d8da9fb52339889915`.

The [validation record](../verification/evidence/split-by-file-demo-2026-10-28/validation.json) records **28 independent outcome predicates**, not 28 features or runtime scenarios. The evidence directory retains six paired before/after snapshots and command responses, the fresh dirty confirmation, a reproducible fixture builder and an outcome checker. Git refs, parents, trees, file bytes and staging observations are independent of either CLI renderer.

Graphite's primary runtime captures use REA 6.7.0 process capture under a PTY, with `--no-interactive`, isolated HOME/config directories, fixed fixture commit timestamps, no remote and refusal sentinels for gh/editor/pager. Anthracite's comparison uses its actual MCP integration in this chat. This establishes the tested noninteractive behavior across these respective transports, not universal PTY/pipe equivalence.

- Main Graphite capture: `ev_9498119c9b6618903b0bc36231cdb7ae7cb25ea59fe77f5e77a1a0cef2e6cfe4`.
- Unmatched path capture: `ev_7d892988b419ac4643fd24039247c7e1c2f176fd56e76996ab80ea4db901583e`.
- The [portable REA bundle](../verification/evidence/split-by-file-demo-2026-10-28/rea-evidence-bundle.json) and per-case captures retain raw observations and limits. No binary analysis session was opened.
- The initial dirty capture remains an **incomplete REA cleanup result**, not a successful complete capture. Its partial terminal observation reports the refusal and exit 1. The independent fresh subprocess confirms the behavior. A later [process observation](../verification/evidence/split-by-file-demo-2026-10-28/cleanup-check.json) found no process using the known Graphite executable; it does not retroactively upgrade REA's cleanup record.

REA samples processes rather than tracing every child or syscall. Network traffic was not observed; credential isolation and absence of remotes do not constitute a network sandbox. Snapshots are observation-time states, not universal rollback guarantees. Git inspection/setup can refresh caches; raw-index and metadata differences are reported separately from logical content preservation. All fixtures are synthetic; no existing project or PR was modified.

## What is missing and what remains open

The [current Anthracite command](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/commands/split.ts#L5-L40) offers commit/hunk styles only. Its [split action](https://github.com/danielbaars/anthracite/blob/3923b1088b29f02ce9d9e2d8da9fb52339889915/apps/cli/src/actions/split.ts#L23-L88) requires prompting and has no native file/pathspec-selection route. Existing branch application and descendant-restack mechanisms are implementation building blocks, not proof that the file mode already works.

A future slice would need to select paths, construct selected/remainder commits, create a parent while retaining the original branch identity, and integrate safety/recovery with descendant restacking. MCP already forwards CLI arguments; this feature does not require another MCP tool.

The official [command reference](https://graphite.com/docs/command-reference#gt-split) and [split tutorial](https://graphite.com/docs/squash-fold-split) document extraction into a parent, repeatable file patterns and noninteractive availability. This demonstration verifies one pattern, one mixed source commit and one nonconflicting child. Repeated/overlapping patterns, all-files selection, multi-commit histories, deletions/renames/binaries, naming collisions, frozen participants, occupied worktrees, hooks/conflicts/continue/abort, PR identity and live service behavior remain untested. The observed `feature_split` name and reused subject are observations for this fixture, not an agreed general naming contract. Resolve those boundaries before implementation.

To verify retained evidence, run `python3 docs/verification/evidence/split-by-file-demo-2026-10-28/check_evidence.py`. Replay setup requires a fresh fixture root and the pinned executables; the builder refuses existing case directories. No new specification, tickets or implementation PR is created by this report.
