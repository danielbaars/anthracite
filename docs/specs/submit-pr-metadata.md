# Noninteractive pull request metadata for submit

Scope and the public-process test boundary approved on 12 November 2026. This is a proposed change, not behavior shipped in npm 0.7.1-beta.1.

## Problem Statement

An agent can submit a branch but cannot pass its approved PR title and description to Anthracite. Noninteractive submission disables the editor and uses inferred metadata. The agent must create the PR with provisional text, then edit it separately, taking care to preserve Anthracite's dependency footer.

## Solution

Add `--title` and `--body-file` to submit. They supply metadata for exactly the submission's starting branch, without changing which branches are submitted. Creation uses the supplied text from its first request; existing PRs can receive metadata changes without another commit. Existing footer management and publication guards remain authoritative.

## User Stories

1. As an agent, I want to supply approved metadata before PR creation, so that provisional descriptions are never published.
2. As a developer, I want to provide a title independently, so that I can retain an existing description.
3. As a developer, I want to provide a description independently, so that I can retain an existing title.
4. As an agent, I want multiline UTF-8 file input, so that Markdown and shell-looking text reach the PR literally.
5. As a developer, I want an empty description file to clear my description, so that clearing is distinguishable from omission.
6. As a developer, I want metadata to affect only the starting branch, so that ancestors and descendants keep their own descriptions.
7. As an agent, I want metadata updates without new commits, so that I need not manufacture code changes.
8. As a developer, I want omitted fields read from the current PR, so that stale cache text cannot overwrite newer edits.
9. As a developer, I want managed footers retained, so that custom descriptions preserve the dependency tree.
10. As an agent, I want invalid input and unavailable targets rejected early, so that unrelated branches are not pushed first.
11. As a developer, I want dry-run to disclose metadata intentions, so that I can inspect the affected PR before publication.
12. As a developer, I want confirmation to use captured input, so that a later file edit cannot silently replace the planned description.
13. As a developer, I want existing scopes, roles and draft decisions preserved, so that metadata grants no additional publication authority.
14. As a developer, I want frozen, identity and concurrent-change guards retained, so that explicit text cannot bypass protections.
15. As an agent, I want partial progress reported accurately, so that a failed submit can be retried without duplicate PRs.
16. As a developer, I want normal interactive editing preserved, so that scripts do not change my existing workflow.
17. As an agent, I want the existing MCP tools to accept these flags, so that no separate metadata tool is necessary.
18. As a developer, I want installed help and examples to explain the target, so that one title is never applied across a stack accidentally.

## Implementation Decisions

- **Inputs:** accept either option or both through submit and its existing aliases. A title must be nonblank and single-line; trim outer title whitespace and preserve its remaining text. A body file must resolve to readable regular UTF-8 text relative to the effective CLI cwd. Reject missing paths, directories, invalid UTF-8 and NUL-containing text. `-` is unsupported stdin input. An empty file explicitly clears the user description, retaining the managed footer.
- **One target:** use the feature branch from `--branch`, otherwise the current branch. It must remain in the final selected editable submission set. Trunk, unknown, frozen, deselected or otherwise skipped targets refuse before any pushes or PR writes; `--update-only` also refuses a target without an existing PR. Do not choose another branch implicitly. Other selected branches still follow normal submission.
- **Field ownership:** supplied fields override inference for the target only. Its first creation request contains those values. Explicit body input replaces the user description rather than adding commit messages or a template. Omitted creation fields use existing defaults; omitted update fields retain current GitHub values. Non-target user text remains untouched by these options. Normal managed-footer reconciliation and separator normalization still apply; do not duplicate, erase or freeze a stale dependency tree.
- **Planning and updates:** capture body contents once before confirmation and external writes. Carry that snapshot through preparation, submission and footer reconciliation; later file edits do not replace it. A separate invocation reads its own input anew. Explicit fields count as metadata work even when code is unchanged. Matching fields need no additional metadata-only write beyond ordinary submission/footer work. Preserve existing push selection, verification hooks and leases; this is not a push-optimization feature.
- **Interaction:** explicit metadata bypasses the target's PR-field prompts, using defaults/current values for omitted fields. It works with noninteractive mode, quiet mode and MCP. `--no-edit` does not discard explicit values. Reject combining `--edit` with explicit metadata before effects. Non-target interaction, other confirmation/role/draft prompts, and the flow without the new options retain their existing contracts.
- **Preview:** show the exact target and effective title change, and disclose body replacement or clearing with its source. Distinguish omission from clearing and include metadata-only work. Dry-run makes no pushes or PR writes; confirmation uses the captured payload. Do not promise a final dependency footer before new PR numbers exist.
- **Protections:** preserve fresh PR discovery, frozen-state checks, local input/parent guards, source leases and post-push propagation handling. Explicit metadata cannot override disabled GitHub integration or missing authority; a known inability to apply it refuses before pushing. Existing allowed planning/cache reads are not a promise of a globally mutation-free repository.
- **Partial effects:** preserve confirmed pushes/PR changes and identify failed or unconfirmed metadata and remaining work. Do not claim rollback or atomicity across a stack. An unchanged caller retry uses fresh discovery and repairs remaining work. Do not add automatic repeats of uncertain creation requests or restore stale cached text.
- **Delivery:** update English help, command guidance and existing MCP learning. No new MCP tool, persistent metadata format or mandatory migration is required. Caller approval requirements remain external to the CLI; supplying flags does not itself grant publication approval.

## Testing Decisions

Use one primary boundary: public CLI processes with real temporary Git repositories and bare remotes, controlling only GitHub responses and writes at the existing gh boundary. Reuse public submit fixtures, targeted-role tests, ancestor/footer freshness tests and submission-input guards. Assert initial create/update payloads, PR state, remote/local refs, metadata and preserved files; stdout alone is insufficient.

| Group | Required acceptance |
| --- | --- |
| Creation and scope | Initial request contains supplied metadata. Current/explicit starting branches, ancestors, descendants and fanout receive exactly their intended fields, including with stack scope. |
| Updates and defaults | Title-only, body-only, empty body, unchanged code and matching metadata. Omitted fields preserve fresh PR values; omitted options retain current creation defaults. |
| Input | Relative paths, spaces, Unicode, multiline Markdown and literal shell-looking text; blank/multiline titles, unreadable/nonregular/stdin/invalid-text inputs refuse before external writes. |
| Selection and protection | Trunk, frozen/deselected/skipped targets, update-only without a PR, disabled integration, hooks, leases, draft/publication options and independent role targets retain their boundaries. |
| Preview and races | Dry-run, declining confirmation, body-file changes after capture, and concurrent head/parent/PR changes preserve the disclosed inputs and existing guards. |
| Footers and failures | Fresh ancestor descriptions, matching/stale managed footers, explicit body edits and partial PR/footer failures; safe unchanged retry with no duplicate creation. |
| Delivery | Focused Node/native cases, core creation/update through an isolated installed npm candidate, and one existing SDK MCP smoke covering discovery/learning, literal arguments and a protected failure. |

No new internal test interface, live GitHub fixture writes, user-project or installation changes. No CI during specification; the full matrix remains off.

## Out of Scope

Stack-wide or per-PR metadata maps; a separate metadata-target flag; inline `--body`, stdin or editor automation; new MCP tools; push optimization; changed role/draft/selection authority; general PR-discovery or footer redesign; persistent-state migration; live fixture publication, implementation tickets, implementation PRs or releases in this specification round.

## Further Notes

Baseline: installed public npm 0.7.1-beta.1 and main source `5183f5198800a3067cd7e81e2cc10975f3cb54f2`. Interactive `--edit` already exists; direct title/body-file inputs do not. The [specification evidence record](../verification/submit-pr-metadata-spec-2026-11-12.md) separates that observation from future implementation acceptance.
