# Anthracite 0.5.0: independent local get/sync controls

**Authority: CONTROLLED-GH.** These are six focused public-CLI observations using actual Git repositories and local bare remotes, not live GitHub results or paired Graphite acceptance. Setup commands are not counted as additional research cases. The source report in the shared worktree was not changed.

Target: Node **24.19.0**, installed public npm `@danielbaars/anthracite@0.5.0`, bundle SHA-256 `da14fac871faab60336d4fd541821f85d9b99a98a13e9d159a3a3aaf2c98ee1a`. Exact target path, controller contract, raw-receipt hashes and observed ref/index changes are in [summary.json](offline-an-controls/summary.json).

## Method

Each fixture has independent producer/consumer repositories, a local bare remote, configured trunk `main`, and an initial graph `main → base → child → tip`, with `sibling` above `base`. Normal `init`, repository setters and `get --unfrozen` import initial tracking state through the public CLI. Git commits, pushes to the bare remote and inspection use literal argument arrays. HOME, Git/global config, GitHub config and Anthracite user config are isolated under the fixture. No global/user account configuration was changed.

Only external `gh` is controlled: the executable accepts GET-style `pr view` requests against exactly `offline-get-sync/repo`, plus `api user`; it projects requested fields from the synthetic PR state and rejects every other route. It performs no network request or PR write. Each result retains command argv, exit/output, every gh argv, local/remote refs, metadata/parents, checkout, index bytes, staging/status and fixture file bytes before/after. Remote bare refs remained unchanged by every command under observation.

## Observations

| ID | Actual command, always with `--no-interactive` | Observed result |
| --- | --- | --- |
| AN01 | `get base` | With remote base, child, tip and sibling advanced, base fast-forwarded but local child/tip/sibling heads and metadata remained unchanged. A new remote-only child was not imported. Checkout moved from tip to base. The command printed the local-children restack warning. Exit 0. [Raw](offline-an-controls/get-existing-base/result.json) |
| AN02 | `sync --no-delete --no-restack` | The bare remote child had advanced. Local child remained at its previous head; checkout and file contents remained child/unchanged. Only branch PR metadata refs changed; the remote-tracking child ref was not refreshed in this fixture. Exit 0. [Raw](offline-an-controls/sync-existing-feature/result.json) |
| AN03A | `sync --no-restack` | Local and remote trunk each had a distinct commit above a shared base. Without force, sync returned 1, retained the local-only trunk commit and reported that trunk could not fast-forward. The fetched origin/main ref and raw index bytes changed; this is not a zero-write refusal. [Raw](offline-an-controls/sync-divergent-default/AN03A.json) |
| AN03B | `sync --no-restack --force` | A separate equivalent divergent fixture returned 0 and reset local main to the remote commit. The local-only commit was no longer an ancestor of main, but its object and main reflog entry still existed at observation time. Feature checkout remained child. [Raw](offline-an-controls/sync-divergent-force/AN03B.json), [reflog](offline-an-controls/sync-divergent-force/main-reflog.txt) |
| AN03C | `sync --delete-all --no-restack` | Rejected before effects with `Unknown arguments: delete-all, deleteAll`, exit 1. Branch refs, working files and raw index bytes were unchanged. This does not certify the desired semantics of a flag Anthracite does not implement. [Raw](offline-an-controls/sync-divergent-default/AN03C.json) |
| AN04 | `sync --no-pull --force --no-restack` | Existing PR associations were first populated while open. After controlled state changed, an independent closed trunk child was deleted, while a CLOSED child above an OPEN base remained. Readback confirms both states. Thus cleanup was active but its traversal did not reach that closed child. Exit 0. [Raw](offline-an-controls/sync-closed-child/AN04.json) |

## Boundaries

The results establish the stated Anthracite behavior only. They do not show what Graphite 1.8.6 does, prove live service/auth behavior, or establish complete dirty/frozen/worktree safety. No terminal-interactive consent path was exercised. Index bytes are recorded rather than assumed unchanged during checkout/pull. The original local-only trunk commit's observed reflog/object retention is not a promise of indefinite recovery.

Three harness assertions were corrected without relabeling them as product failures: reading a cache-only revision field from persisted metadata after AN01; looking up an unfetched producer object in the consumer before AN03A; and expecting singular rather than the actual plural/camel-case parser diagnostic after AN03C. Successful command receipts were kept unchanged and independently revalidated from their captured heads/state. No target command was rerun to replace these observations. The summary records these interruptions explicitly. Harness files are retained as one-off procedural evidence; do not rerun initialization over these existing fixtures.
