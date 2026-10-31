# Refresh a local stack with get

This describes the get-update source candidate for [#69](https://github.com/danielbaars/anthracite/issues/69), not functionality shipped in public 0.5.1. See the [implementation verification](verification/get-updates-implementation-2026-10-31.md) for exact candidate/runtime evidence and review status.

`an get [branch]` and `an g [branch]` refresh the target's validated PR ancestor chain and eligible **locally tracked descendants of the target**. A numeric argument is a PR number. Omission uses the physical current branch; detached HEAD needs an explicit target. Naming trunk keeps the existing no-op behavior and never selects every stack.

## Defaults and explicit controls

The candidate intentionally changes the 0.5.1 defaults: descendant remote refresh and automatic restack are enabled. Final target checkout remains enabled.

| Control | Default | Effect |
| --- | --- | --- |
| `--downstack` | `false` | Restrict remote refresh to the required PR chain. |
| `--restack` / `--no-restack` | `true` | Replay affected editable local work after all incoming updates, or retain its histories and report pending maintenance. |
| `--checkout` / `--no-checkout` | `true` | Select the target on complete success, or restore the original physical checkout after all enabled phases. |
| `--force`, `-f` | `false` | Permit overwrite of eligible selected feature sources. It never resets trunk or bypasses local-file/worktree guards or changes existing frozen status. |
| `--unfrozen`, `-U` | `false` | Make new imports editable. Existing stored status remains unchanged. |

Ordinary explicit booleans work on both command names, for example `--downstack=false`, `--restack=false` and `--checkout=true`. The controls are independent:

```sh
an get feature                         # descendant refresh, maintenance, target checkout
an g 123 --no-checkout                  # explicit PR target; retain original checkout on success
an get feature --downstack --no-restack # bounded old-selection/no-replay compatibility recipe
an get feature --downstack --no-restack --no-checkout
```

The compatibility recipe preserves the earlier remote-selection/replay scope. It still permits the new safe trunk fast-forward and validated parent adoption; it does not promise byte-identical old execution.

## Refresh and maintenance are separate

For `main → base → child → tip`, getting `base` normally refreshes eligible local `child` and `tip` sources too. Getting `child --downstack` refreshes `base` and `child`, excluding `tip` and sibling remote heads. If a shared feature parent changes, a sibling outside remote refresh may still need **local maintenance**. Get names that maintenance separately. An independent trunk stack is not replayed merely because trunk advances.

Every selected branch uses its own validated PR parent and pinned source, in dependency order. Get does not discover remote-only descendants, require unpublished work to be published, create PRs, push or delete branches. A tracked descendant with no PR association and a confirmed normal absence of a PR stays local-only and can still need maintenance. Missing required/associated sources, authentication, rate-limit, transport and invalid identity responses are errors, not local-only skips.

For feature targets, configured remote trunk is identical or advanced by fast-forward only. Local trunk ahead of or diverged from remote refuses; feature force cannot reset it. A validated PR-base change can update parent metadata with an identical/fast-forward feature head without overwrite permission. The former parent remains present.

After all incoming heads apply, maintenance preserves surviving branches' own commits, authors, complete messages and content through ordinary Git replay. A separately chosen reconciliation rebase remains allowed even with `--no-restack`; that flag disables automatic maintenance only.

## Imports, frozen anchors and local work

Verified own PR imports are editable; another or unknown author is conservatively frozen. Verification uses read-only `gh` account/PR information, not Git author names/email, and does not launch a login flow. `-U` changes new imports only. Inbound refresh retains existing frozen status, including permitted fresh freeze changes. Automatic maintenance does not replay frozen history: it names retained frozen anchors and permits editable descendants to use them only under the existing safe policy. Deferred/skipped work is not reported as fully restacked.

Tracked staged/unstaged work retains conservative refusal before stack-changing application. Untracked and ignored collisions and occupied affected worktrees remain protected, including with force. Known blockers are checked before affected writes and relevant state is checked again around hooks/publication. Fetch/cache/tracking-ref writes may already have occurred during discovery. There is no automatic stash, broad dirty-worktree guarantee, foreign-worktree exception or atomic rollback.

`--no-checkout` restores branch **identity**, so an original branch updated by the operation is selected at its authorized new head. Detached restoration selects the exact original OID. Intermediate checkouts can occur. A missing original, final collision, occupied branch or hook/switch failure returns nonzero with reached work and actual checkout; get never resets or recreates a ref to fake restoration.

## Conflict recovery and release boundaries

A real reconciliation/maintenance conflict keeps Git's reached conflict state. Inspect the printed original project, resolve deliberately, stage the intended resolutions, then use `an continue` or `an cont` in that original worktree. `--all` deliberately stages resolutions only after owned-recovery protections validate. The saved get operation retains pinned sources, each parent, remaining incoming/maintenance work, import decisions and resolved replay/final-checkout policy across processes; continuation does not fetch new sources or apply new get defaults.

A newly frozen/occupied mandatory replay or changed ref/parent refuses before advancement. Wrong repository/worktree, foreign/incompatible intent, raw abort and ambiguous publication/checkout effects require guarded inspection. Raw `git rebase --abort` cancels only its active Git rebase, retaining earlier updates and saved state; it is not a rollback or permission to consume a stale queue. A completed Git replay with failed metadata publication remains pending maintenance without a live replay to continue blindly. Preserve the reported records/pins and inspect actual refs/index before further action.

Finish a pending graph-aware get before downgrading. Older releases are not certified to resume its optional owned intent. Existing metadata/settings and legacy supported continuations remain readable. Sync retains its separate defaults, force and cleanup policy, including the B02 repair shipped in 0.5.1. Get adds no cleanup/delete-all, remote-only discovery, multi-trunk or broader sync-refresh implementation.

The [MCP guide](mcp.md#get-through-the-existing-tools) uses the same flags and failure envelope. Local controlled-gh acceptance does not establish live GitHub/Graphite service parity or a release installation guarantee.
