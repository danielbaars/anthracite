# Landing plan presentation: bounded comparison and verification

Date: 2026-11-02. Implementation status: local unreleased candidate after npm 0.6.2.

## What was actually observed in Graphite

The installed Graphite 1.8.6 executable was run through REA process capture in a separate synthetic repository. Its executable SHA256 is retained in each capture. No native analysis session or engine installation was needed.

| Input boundary | Actual output | What this establishes |
| --- | --- | --- |
| Existing synthetic tip, locally tracked without a PR association; normal local `get` did not establish an association in this probe | `ERROR: The following branches do not have associated PRs`, the branch name and `Please submit and then retry.` | A short, concrete blocker plus a next action in this observed case. |
| Three locally created branches and explicitly fictitious cached open PR records | `ERROR: Cannot determine if stack is ready to merge` | The real CLI still lacked mergeability evidence. This was not a successful Graphite plan or a live PR/merge test. |

The captures are [missing association](evidence/land-presentation-2026-11-02/graphite-merge-capture.json) and [controlled cache](evidence/land-presentation-2026-11-02/graphite-merge-controlled-capture.json). Readable terminal extracts are retained beside them. The latter cache explicitly labels its PRs synthetic; no corresponding remote PRs were created. REA evidence IDs, provider, terminal shape, executable identity, timing, truncation and residual unknowns remain in the unchanged JSON records. Network activity was not observed by these captures; filesystem observation was not requested. Graphite may maintain its own local cache/onboarding files and launch background processes.

## Live Graphite preview: approved follow-up

After explicit authorization, only the public synthetic repository `danielbaars/anthracite-land-smoke-2026-11-02` was temporarily added to Graphite sync. The original two personal sync selections were preserved. Real Graphite submission created [base #5](https://github.com/danielbaars/anthracite-land-smoke-2026-11-02/pull/5), [child #6](https://github.com/danielbaars/anthracite-land-smoke-2026-11-02/pull/6) and [tip #7](https://github.com/danielbaars/anthracite-land-smoke-2026-11-02/pull/7). Each received the exact approved English title and body. No assignees, reviewers or issues were added.

The same Graphite 1.8.6 binary was captured with `merge --dry-run --no-interactive` on `preview-tip`:

| Input boundary | Actual result | Evidence |
| --- | --- | --- |
| All three real PRs are drafts | Exit 1; short `Your stack is not ready to merge` message followed by each branch and `Draft` | [Draft capture](evidence/land-presentation-2026-11-02/graphite-live-draft-capture.json), [terminal extract](evidence/land-presentation-2026-11-02/graphite-live-draft-capture.txt) |
| The same PRs are marked ready; local worktree clean | Exit 0; ready message and branch names, with no commit IDs | [Ready capture](evidence/land-presentation-2026-11-02/graphite-live-ready-capture.json), [terminal extract](evidence/land-presentation-2026-11-02/graphite-live-ready-capture.txt) |
| The same ready PRs, plus one synthetic local untracked file | Exit 0; the same ready message and branch list | [Dirty capture](evidence/land-presentation-2026-11-02/graphite-live-dirty-capture.json), [terminal extract](evidence/land-presentation-2026-11-02/graphite-live-dirty-capture.txt) |

The successful Graphite output was:

```text
Running merge in 'dry-run' mode. No PRs will be merged.

🥞 Validating that this Graphite stack is ready to merge...

✅ Your stack is ready to merge.
Preparing to merge:
▸ preview-tip
▸ preview-child
▸ preview-base

✅ Dry run complete.
```

Graphite displayed this list top-down. This observation does not establish actual merge execution order: no real merge was run. The captured preview did not explain local cleanup or maintenance. Anthracite deliberately keeps its actual bottom-up execution order and explicit surviving-branch effects in the concise plan. It also retains its clean-worktree requirement because its operation performs local replay. Graphite accepting this one untracked file is not evidence that every kind of dirty state is accepted.

All three retained live captures completed without truncation, with verified owned-process cleanup and removed capture temporary roots. An earlier repeat encountered REA cleanup uncertainty; it was not used as the retained successful capture. Network requests and filesystem effects were not observed by these process captures.

After measurement, all three test PRs were closed without merging. Their heads and remote `main` remained unchanged, the synthetic local note was removed, and the temporary Graphite sync selection was removed. The original two personal selections were visibly restored. The test repository has zero Actions runs. See [initial draft metadata](evidence/land-presentation-2026-11-02/live-test-prs-draft.json) and [final cleanup checks](evidence/land-presentation-2026-11-02/live-test-cleanup.json). Screenshots of personal Graphite settings are kept locally, outside this public evidence directory.

**Remaining boundary:** actual Graphite merge execution, conflict recovery and policy semantics were not tested here. This is a presentation comparison, not a claim of full behavioral or byte parity.

## Anthracite before and after

A real temporary Git repository and local bare remote were used for both the released npm 0.6.2 CLI and the source candidate with the same three-PR fixture and controlled GitHub responses. Both previews preserved local persistence and remote refs. The released output contained 20 logical lines, including full commit IDs and repeated implementation details. The candidate contained 16 logical lines, with PR order, maintenance and cleanup; that count describes this fixture only.

- [Released 0.6.2 output](evidence/land-presentation-2026-11-02/anthracite-before.txt)
- [Candidate output](evidence/land-presentation-2026-11-02/anthracite-after.txt)
- [Candidate with local work](evidence/land-presentation-2026-11-02/anthracite-blocked-after.txt)

The candidate puts blockers and dirty-state guidance first, retains ordered branch names/PR numbers, identifies existing published pushes and PR base/footer updates, and identifies work that remains unpublished. Existing technical details move to `--debug`. Confirmed-merge-only local/remote cleanup remains explicit. Existing pending recovery presentation remains detailed and unchanged.

## Verification and delivery boundary

The first blocker-first public CLI regression failed against the original renderer and passed after the repair. Four presentation cases plus three retained preview cases pass on Node 24.19.0 and a macOS ARM64 Bun 1.3.14 native candidate: seven per runtime, 14 final passes. Cases cover dirty-state preservation and guidance, full ordered scope without hashes, debug details, fanout/unpublished scope, existing exact-prefix preservation, verified merged cleanup and readiness blockers. Build, typecheck, changed-source lint, formatting and whitespace checks pass.

See [retained results](evidence/land-presentation-2026-11-02/results.json). The initial presentation repair changed fresh-plan rendering and help only. It changed no selection, policy, confirmation, merge, push, cleanup or recovery behavior. No application checkout, active Anthracite installation, shell completion or MCP registration was changed; no CI/full matrix was started. GitHub writes were limited to the three explicitly approved synthetic test PRs and their lifecycle; no implementation PR or release was created. The comparison and evidence can be published on a documentation-only branch independently of the still-local implementation.

## Follow-up: waiting and section icons

The same local candidate was subsequently extended with section icons, clearer progress and bounded waiting for known running checks after confirmation or during explicit resumption. The outputs above describe the initial presentation stage. See the [waiting and recovery verification](land-check-waiting-2026-11-02.md) for current examples, expanded acceptance and real published-0.6.2 recovery compatibility.
