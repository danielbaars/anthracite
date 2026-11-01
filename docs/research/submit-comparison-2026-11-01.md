# Submit comparison: Graphite 1.8.6 and Anthracite 0.6.0

Date: 1 November 2026. This is a compact practice comparison, not an implementation specification or a complete authenticated submit audit. All Git mutations used disposable local repositories; no live PR was created, changed or submitted. No CI, full matrix, package installation or release was started.

## Finding

The useful missing workflow is **explicit `submit --restack`**, rather than unconditional automatic restacking on every submit. Both tools refuse the tested stale feature chain without that option. Graphite integrates repair into submit; Anthracite 0.6.0 rejects the option, but its existing `restack --downstack` followed by `submit --dry-run` repairs and previews the same selected chain.

There is an important Graphite discrepancy to avoid copying: **`gt submit --dry-run --restack` really rewrites local branches in 1.8.6**, although its installed help and the [official reference](https://graphite.com/docs/command-reference#gt-submit) describe dry-run as not restacking. Independent Git snapshots prove that this is more than misleading terminal wording. The eventual Anthracite design should keep preview and application distinct.

## Fixture and execution boundary

Each fresh fixture has the same logical commits and files:

```text
main → base (amended after tracking) → child → tip ← HEAD
           └────────────────────────→ sibling
main → other
```

The amendment leaves `child` and `sibling` based on the old base commit. Names actually carry the unique `submit-probe-20261101-` prefix. The fanout case starts on `base`; the others start on `tip`. The conflict case adds `child.txt` differently in the amended base and child. Freeze and occupied-worktree cases protect `child`; both CLIs' freeze command also freezes its downstack base in this fixture.

Every measured submit invocation includes `--dry-run --no-interactive`. Graphite uses its real installed native binary and an isolated private copy of existing authentication for read-only service discovery. Explicit repository owner/name avoids confusing discovery through the Git URL rewrite. A local bare repository receives all Git transport through `url.insteadOf`; its heads remain unchanged. Anthracite uses the installed npm 0.6.0 bundle with a controlled `gh` helper that reports no matching PR, accepts auth-status inspection and rejects every other helper operation. Live GitHub inspection before and after verifies that no PR has any of the unique fixture heads. This is not a paired live publication test or a claim that both tools use the same service adapter.

## Seven paired cases and five Anthracite controls

The retained [observations](../verification/evidence/submit-comparison-2026-11-01/observations.json) contain independent before/after refs, parent relations, ancestry, checkout, working-file hashes and conflict state. [REA captures](../verification/evidence/submit-comparison-2026-11-01/rea-captures.json) retain the seven accepted Graphite terminal captures and one earlier successful exploratory preview.

| Case | Graphite 1.8.6 submit result | Anthracite 0.6.0 result / separate control |
| --- | --- | --- |
| Default stale-chain preview | Exit 1: must restack; no head changes. | Exit 1: not restacked on parent; no head changes. |
| Explicit `--restack` | Exit 0. Rewrites `child` and `tip`, keeps `sibling` stale and unchanged, and lists base/child/tip for creation. Restores tip checkout. | Option rejected. Separately, `restack --downstack` repairs child/tip; ordinary submit preview then succeeds with the same three branches. |
| Explicit `--restack=false` | Same refusal as the default; no head changes. | Option rejected, including explicit false. This is a parsing/interface gap, not a second execution defect. |
| `--restack --stack` from base | Exit 0. Rewrites child, tip and sibling; lists all four feature branches. The independent `other` stack and trunk remain unchanged. Restores base checkout. | Restack option rejected. Separately, ordinary restack from base repairs those same three heads; `submit --stack --dry-run` lists the same four branches. |
| Real replay conflict | Exit 1: cannot restack child cleanly; directs the user to `gt restack`. Branch heads and original checkout remain unchanged, with no active rebase or unmerged index. | Restack option rejected. Separate `restack --downstack` exits 1 with the real `child.txt` conflict and an active rebase, plus `an continue` guidance. Its conflict policy is already different. |
| Frozen child/downstack base | Exit 0. Skips replay of the frozen branches, but its preview still lists all three branches as Create. No heads change; child is still stale against base. | Restack option rejected. Separate restack skips the same frozen anchors; subsequent submit preview skips those branches and lists only editable tip. Do not infer that Graphite actually pushed a frozen branch from a preview. |
| Child in another worktree | Exit 0. Skips occupied child replay, keeps tip anchored to child, and lists base/child/tip. Child remains stale against base. | Restack option rejected. Separate restack refuses before replay because child is occupied. No heads change. |

These are seven paired scenarios and five component-workflow controls, not feature-acceptance totals or a product test suite. The six Anthracite invocations containing an unsupported restack option exercise the same parser boundary; they do not establish six separate missing protections. Existing components can provide the clean chain and fanout outcome today. The missing integration is scope-aware repair, truthful preview, protection handling and recovery inside submit.

## Secondary metadata and review differences

The [source/options note](../verification/evidence/submit-comparison-2026-11-01/source-options.md) separates installed help from source evidence. These modes were not exercised against live PRs in this investigation.

- Graphite advertises granular title/description prompt controls and `--rerequest-review`. Anthracite has combined edit/no-edit and no re-request-all flag. These are concrete interfaces, but their exact Graphite service effects are unverified here.
- Missing `--team-reviewers` is a shortcut difference: Anthracite already accepts `--reviewers org/slug`. Its explicit reviewer additions can also request named users when no pending request remains; absence of a re-request convenience flag is not proof that re-requesting a named user is impossible.
- Anthracite already has `--assignees` and per-PR `--roles-branch` targeting. Those are not missing features.
- An existing-PR metadata concern needs a focused reproduction before being called a bug: the [preparation path](https://github.com/danielbaars/anthracite/blob/v0.6.0/apps/cli/src/actions/submit/prepare_branches.ts#L315) captures edited title/body, but the [existing-PR write adapter](https://github.com/danielbaars/anthracite/blob/v0.6.0/apps/cli/src/actions/submit/submit_prs.ts#L218) does not send those fields. The later [footer phase](https://github.com/danielbaars/anthracite/blob/v0.6.0/apps/cli/src/actions/submit/submit_action.ts#L241) can incidentally publish the edited body. This is source evidence, not a newly observed live title/body failure.

AI/web submission, alternate trunk selection and auto-merge remain separate product/backend scope. They are not prerequisites for a useful agent-oriented submit improvement.

## Smallest useful next round

Specify an opt-in `submit --restack`, keeping the ordinary default and existing publication approvals. Resolve the submission and required repair scopes before mutation; restrict a tip-only chain and include fanout only when selected. Do not implicitly call repository-wide sync or widen push, cleanup or overwrite authority.

Keep `--dry-run` free of branch-history rewrites, even when combined with `--restack`; report planned maintenance and any uncertainty rather than reproducing the measured Graphite surprise. Reuse existing frozen/worktree protection and honest conflict state. Define explicitly whether continuation finishes only local maintenance; a saved conflict must not silently grant later PR publication. Retain role targeting, draft/publish behavior and leases.

Then reproduce the existing-PR edit concern with a controlled installed-bundle adapter or separately approved live fixture. Do that before adding more metadata flags. Granular prompts and re-request-all can wait until their practical value and exact behavior are measured. This report does not approve implementation, publish a specification or open implementation issues.

## Evidence and limitations

[Identities](../verification/evidence/submit-comparison-2026-11-01/identities.json) pin Graphite 1.8.6, npm Anthracite 0.6.0, Node 24.22.2 and artifact digests. Examined Anthracite source files match released commit `eb23e4f8e924da24e00ae06484799687adde66b1`; the earlier source snapshot used by the options note has the same examined blobs. The [help captures](../verification/evidence/submit-comparison-2026-11-01/gt-submit-help.txt) preserve the advertised Graphite interface independently of its measured dry-run behavior. The [Anthracite help](../verification/evidence/submit-comparison-2026-11-01/an-submit-help.txt) and [registered handler](https://github.com/danielbaars/anthracite/blob/v0.6.0/apps/cli/src/commands/submit.ts) corroborate the absent option. Its [validation](https://github.com/danielbaars/anthracite/blob/v0.6.0/apps/cli/src/actions/submit/validate_branches.ts#L85) is distinct from its existing restack engine.

Accepted Graphite REA captures exited normally without output truncation and verified owned-process cleanup. Filesystem effects were not collected by REA itself; the separate Git snapshots establish the bounded head/tree/conflict findings. One accepted `--restack=false` capture also reports an unverified platform-process sample (`platform_binary_environment_withheld`); verified owned-process cleanup does not certify every sampled host process. No unverified PID was killed. Inherited environment, transient process sampling and full byte-level cache/index effects remain limitations. The accepted Anthracite controls use ordinary subprocess captures, not a new MCP transport certification.

Early setup probes without authentication, with an invalid synthetic token, or with all network denied stopped before the relevant workflow. A network-denied REA capture using `env -i` also lost process-ownership verification and returned only partial evidence; it is excluded from accepted case outcomes. Its unverified PIDs were not killed. Fresh direct captures with isolated configuration, valid discovery and explicit repository identity supply the accepted observations. Private auth files are not retained in this evidence directory and their temporary copies were removed after capture.

Not tested: actual push/PR publication ordering and leases after repair, interactive restack confirmation, existing-PR editing/re-review service effects, dirty input, arbitrary hooks, interruptions, broad rollback or cross-platform behavior. Neither a successful preview nor the separate restack controls certifies those workflows. Follow the [evidence README](../verification/evidence/submit-comparison-2026-11-01/README.md) to recheck retained outcomes.
