# Submit metadata and review interface comparison

Date: 2026-11-01. Boundary: installed `gt submit --help` (Graphite 1.8.6), installed `an submit --help` (Anthracite 0.6.0), and Anthracite release-source snapshot `cb5f215a52e04ac871d375a8d822ea6ea4e2e413` at `/private/tmp/anthracite-npm-publication-20261101/source`. Only help commands and source reads were performed. No submit execution, GitHub writes, CI or matrix. Graphite help describes advertised behavior; it does not prove successful service execution.

## Concrete interfaces

| Area | Graphite 1.8.6 advertised interface | Anthracite 0.6.0 evidence | Assessment |
| --- | --- | --- | --- |
| Automatic restack | `--restack`, default false; dry-run explicitly promises no restacking | No restack option in complete submit registration (`apps/cli/src/commands/submit.ts:6–99`); invalid feature ancestry refuses (`actions/submit/validate_branches.ts:104–113`) | Clear first investigation target; runtime behavior belongs to parent's paired probes. |
| Edit selected metadata fields | `--edit-title`, `--no-edit-title`, `--edit-description`, `--no-edit-description`; documented precedence relative to edit/no-edit | Only combined `--edit`/`--no-edit` (`commands/submit.ts:28–39`); no interactive editing in noninteractive/dry-run (`actions/submit/submit_action.ts:65–80`) | Granular interactive field controls absent from registered Anthracite interface. Not proven useful for noninteractive agents, since Graphite's controls are prompts. |
| Re-request current reviewers | `--rerequest-review` | No dedicated flag (`commands/submit.ts:6–99`). Existing `--reviewers` adds explicit supplied reviewers; pending requests are preserved and omitted from additions (`actions/submit/request_reviewers.ts:70–95`) | Distinguish missing convenience flag from a blanket inability to request review again. Explicit `--reviewers user` may request review again when no request remains; live semantics untested. |
| Team reviewers | `--team-reviewers` shortcut or `--reviewers org/slug` | Already accepts `--reviewers org/slug` and verifies team slug (`commands/submit.ts:41–45`; `actions/submit/request_reviewers.ts:27–39`) | Missing shortcut only, not a missing team-review feature. |
| Role targeting | Graphite help lists reviewers and team-reviewers; no assignees or roles-branch option shown | `--assignees` and `--roles-branch` registered (`commands/submit.ts:47–55`); both lists narrowed independently from submit branch selection (`actions/submit/prepare_branches.ts:51–60`) | Anthracite already provides useful agent-oriented functionality. Absence from Graphite submit help is not proof Graphite cannot assign through another route. |
| Comment and post-submit browser | `--comment`, `--view` | Neither registered | Additional interfaces, not first-round priorities by themselves; equivalent single-PR work can use gh. Their exact Graphite scope/service behavior was not exercised. |
| Hosted metadata/automation | `--ai`/`--no-ai`, `--web`/`--cli`, `--merge-when-ready` | None registered | Do not sweep into a small standalone submit parity round; hosted/automatic merge proposals need separate product and authorization decisions. |
| Alternate trunk and override | `--target-trunk`, `--ignore-out-of-sync-trunk` | Neither registered | Separate multi-trunk/consistency scope, not metadata polishing. No probe of either Graphite behavior. |

Shared registered controls include stack, branch, draft/publish, combined edit/no-edit, reviewers, dry-run, confirm, update-only, force and always. Anthracite additionally has interactive `--select`. Common spelling does not establish full behavioral parity.

## Source finding worth a focused regression probe

Existing-PR `--edit` looks incomplete in Anthracite 0.6.0:

1. `actions/submit/prepare_branches.ts:315–347` prompts for a new title/body and stores them in local PR metadata; `:358–364` returns those fields in the update request.
2. `actions/submit/submit_prs.ts:218–267` applies only a changed base and requested draft state. It never sends `request.title` or `request.body` for an existing PR. New PR creation does send both (`:181–194`).
3. The later dependency-footer phase (`actions/submit/submit_action.ts:241–263`) sends a body only when the cached body lacks the newly generated footer. Therefore an edited body can be published incidentally when its footer differs, but is not reliably updated independently; there is no corresponding title write.

Status: demonstrated source path, not a live failure claim. A narrow installed-bundle adapter or approved live existing-PR probe should check whether edited metadata appears locally but not remotely before filing a concrete bug. Do not describe the entire edit feature as absent or already verified broken.

## Suggested priority

First prove automatic restack scope, dry-run preservation, conflict outcome and publication boundary. Then investigate the existing-PR edit path above before adding new metadata flags. Only after that choose whether granular title/body editing or re-request-all-current-reviewers provides enough value for this project's agent-oriented use. Retain existing role targeting and direct GitHub authentication.
