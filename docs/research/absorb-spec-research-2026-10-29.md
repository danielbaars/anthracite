# Absorb specification research — 29 October 2026

## Result and authority

The [approved specification](../specs/absorb.md) combines the owner's seven public test groups with the [original five paired demonstrations](absorb-demo-2026-10-29.md), eight additional pinned Graphite scenarios, and static Anthracite source analysis. The new observations explain target selection and staging behavior, but do not certify an implemented Anthracite feature. The installed npm Anthracite 0.2.1 still has no absorb route.

The product baseline is Anthracite source commit 966877d4c382560c58d31a3ea9623705c57dbb83 and installed npm 0.2.1, running on Node 24.19.0. Graphite is the same unchanged 1.8.6 executable used by the demonstration (SHA-256 9153b4b6d9ad8084ec700a1fb80dd8a4b35c08c3116bf41f1fcdd792b326781f). Documentation branches do not change the product baseline. [Artifact identities](../verification/evidence/absorb-spec-2026-10-29/identities.json) retain these file/runtime hashes and a post-observation identity check.

## Additional observations

All cases start in owned temporary repositories without remotes. Setup uses real Git and Graphite init/track/restack. Captured targets run with an explicit env -i environment, isolated HOME/config/gh directories, fixed fixture dates and refusal sentinels for editor, pager and gh. No input events are needed for these eight runs. The ordinary force cases use absorb --force --no-interactive. CLI output, independent before/after Git snapshots and full commit headers/messages are retained separately.

| Scenario | Measured Graphite 1.8.6 result | Contract implication |
| --- | --- | --- |
| Two commits in one branch | Two changed files target two distinct original commits within refactor, including its interior commit. Two original authors/dates and complete subject/body messages retain order and identity. Independent tree observations locate the first correction in the first rewritten commit and the other in the second. | Branch-tip amendment alone is insufficient; do not flatten author/message history. |
| Repeatedly edited line | An API commit edits a line originally introduced by refactor. A correction goes to that later API commit; refactor stays unchanged. | Use the most recent noncommuting historical destination, not earliest file introduction. This case is deterministic, not a general proof of ambiguity handling. |
| Two hunks in one file | The first line belongs to refactor; a distant tail line was changed by API. Graphite amends each hunk into its own target commit. | Select per hunk and translate line context through history. |
| Mixed local work | A staged first-line correction is absorbed while an unstaged tail-line edit in the same file stays unstaged with the same diff. All working-file bytes survive. | Restoring only a staged patch or blindly staging work is insufficient. |
| --all --dry-run | Returns 0 and prints a preview, but the tracked previously unstaged correction becomes staged in the real index. The new untracked file remains untracked; refs do not move. Raw index and captured metadata change. | Anthracite deliberately projects tracked input without writing the user's index. |
| --all application | The tracked correction is absorbed, while an untracked file remains untracked and byte-identical. | Absorb's all flag must be tracked-only, unlike Anthracite's existing general add-all helper. |
| No force, noninteractive | absorb --no-interactive returns 0 and prints Dry run complete without rewriting refs. Raw index/cache state changes but staged content and work remain. | Anthracite deliberately requires explicit force for noninteractive application and reports a missing flag as a failure. |
| Intended conflict from a middle branch | From api, an earlier helper correction is absorbed and api replayed. The tests child overriding that line remains at its old ref/parent, with its original tree, so it becomes stale. Graphite returns 0; there is no active rebase. The baseline README leftover remains staged. | This did not produce an absorb conflict. The archived scenario name conflict describes the original probe intention, not its outcome. No Graphite absorb/continue claim follows. Anthracite's mandatory descendant replay and conflict acceptance are explicit product requirements. |

The [new validation report](../verification/evidence/absorb-spec-2026-10-29/validation.json) checks 49 outcome predicates across these eight scenarios. These are neither 49 feature certificates nor 49 independent runtime tests. The earlier demonstration's five paired cases and 71 predicates are a separate historical result, not repeated implementation acceptance.

## Source analysis and decisions

The [unchanged source advisory](../verification/evidence/absorb-spec-2026-10-29/source-notes.md) pins all detailed observations to the product source baseline. Key distinctions:

- Ordinary current-tip amendment/restacking and interactive branch editing exist; automatic hunk selection and interior-commit amendment do not. Whole-own-range replay and checked ref publication are useful prior art, not a complete absorb implementation.
- The file-split construction path flattens history and uses the invoking author; applying it unchanged would violate the approved author/message contract.
- Generic continuation stores branch queues and structural roles, but no selected absorb amendments or retained-input restoration checkpoint. Ordinary context initialization and no-rebase continue can clear existing continuation state. A new minimal role/owned input record must integrate with those lifecycle boundaries without discarding the only copy of local work.
- Existing general add-all stages untracked files. Existing inspection initialization avoids ordinary metadata cleanup; strict absorb dry-run needs that preservation property and cannot just skip the final commit.
- Frozen candidate exclusion is different from protection of mandatory replay participants. Worktree and intermediate-file guards exist but need the full selected participant set.
- Mixed staged/unstaged work must remain separate from Git's conflict-resolution index. There is no existing universal stash/restore transaction whose correctness can be assumed.

The specification resolves those seams through public outcomes rather than private method signatures or a generic framework. It explicitly bounds automatic absorption to ordinary text hunks, keeps unsupported staged entries visible, rejects dry-run+patch and all+patch, preserves canceled selection, and requires truthful reached-state recovery. Hook failures without an active continuable rebase get a tested manual path; no universal undo or post-abort automatic resume is promised.

## Evidence, replay and limits

The [complete inline captures](../verification/evidence/absorb-spec-2026-10-29/captures.json) retain each REA Evidence identity, original argv/environment, terminal frames, exit, truncation and cleanup details. REA is 6.7.0; all eight targets exit normally with untruncated terminal evidence. No disassembler target or analysis database was opened. Process observation is sampled; the shared-line capture includes a restricted-process-environment unknown. Do not kill or attribute an unverified process by PID alone. Environment isolation, absent remotes and unused sentinel tools do not constitute a network/process sandbox or prove absence of traffic.

The [retained-file manifest](../verification/evidence/absorb-spec-2026-10-29/manifest.json) hashes the selected evidence, snapshots, original fixture helpers, source advisory and independent verifier. No binaries, credentials or entire test repositories are published. Original scripts retain their actual scratch paths: the new fixture helper imported the original demonstration helper at its recorded temporary location; an unchanged copy is retained as demo_fixture.py. A fresh execution replay requires restoring those helper locations or an explicitly reviewed local path adjustment and an absent fixture root. Verification of the retained snapshots is portable: run python3 docs/verification/evidence/absorb-spec-2026-10-29/verify_states.py.

The extra-observations record retains direct Git reads of the rewritten interior commit trees and absence of active rebase directories after the runs. Commit IDs are expected to change; those observations compare content, ancestry and full original attribution/messages instead. A probe setup/check attempted to inspect a non-existent Graphite metadata ref after measurement and failed; no target mutation resulted and no claim relies on that absent ref. Raw all-ref and commit data remain authoritative.

Not measured here: arbitrary overlapping or duplicated patch context, automatic whole-entry/binary/rename handling, interactive confirmation/patch, hooks, actual absorb conflict continuation, protected continuation, cancellation, large repositories or platform-wide behavior. The proposed acceptance cases for these boundaries are future Anthracite requirements, not claims that Graphite already passed them. No live PR, product implementation, dependency/build change, release, global installation or CI run is part of this research.

Primary documentation: Graphite's [command reference](https://graphite.com/docs/command-reference#gt-absorb) describes the interface; its [mid-stack tutorial](https://graphite.com/docs/update-mid-stack-branches#absorbing-changes-into-your-stack) explains commuting hunks through candidate history. These inform the specification; the eight pinned observations establish only their recorded cases. The documents were consulted on 29 October 2026, independently of the pinned executable version.
