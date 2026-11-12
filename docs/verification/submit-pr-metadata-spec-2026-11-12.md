# Submit PR metadata specification evidence

Scope and one public-process test boundary were approved on 12 November 2026. This record supports the [proposed specification](../specs/submit-pr-metadata.md); it does not claim candidate implementation or test acceptance.

## Observed baseline

- Installed MCP execution reports public npm **0.7.1-beta.1**. `submit --help` exposes interactive `--edit` and says noninteractive mode disables it. It has no `--title` or `--body-file`. The unchanged [CLI responses](submit-pr-metadata-evidence-2026-11-12/cli.json) retain both commands and their status/output.
- Main is pinned to `5183f5198800a3067cd7e81e2cc10975f3cb54f2`. [Submit registration](https://github.com/danielbaars/anthracite/blob/5183f5198800a3067cd7e81e2cc10975f3cb54f2/apps/cli/src/commands/submit.ts) confirms those options; [submit planning](https://github.com/danielbaars/anthracite/blob/5183f5198800a3067cd7e81e2cc10975f3cb54f2/apps/cli/src/actions/submit/submit_action.ts) disables inline edits without prompting capability.
- [Title preparation](https://github.com/danielbaars/anthracite/blob/5183f5198800a3067cd7e81e2cc10975f3cb54f2/apps/cli/src/actions/submit/pr_title.ts) prefers a saved title, otherwise the oldest branch commit subject. That is an editable default, not a mandatory PR title.
- [Body preparation](https://github.com/danielbaars/anthracite/blob/5183f5198800a3067cd7e81e2cc10975f3cb54f2/apps/cli/src/actions/submit/pr_body.ts) uses existing/template/commit-message input and an interactive editor. Existing submit action planning already distinguishes edit-driven work; direct metadata must also be recognized when code is unchanged.

## Approved boundary

Only `--title` and `--body-file`, applied to the starting feature branch; submission scope and role scope remain independent. Omitted fields, other descriptions and managed footers retain their respective ownership. No bulk metadata, stdin, new MCP tool, push optimization or authority expansion.

Reuse the existing public submit fixture with real Git/bare remotes and a controlled gh process, the targeted-role and fresh-ancestor-footer cases, submission-input concurrency guards and the SDK MCP client. Future acceptance must inspect initial payloads and actual state, not merely match success text. Focused Node/native and installed-package checks are planned, not performed during this specification.

No CLI code, user project, installation or live GitHub fixture was changed. No CI or full validation was started. Publication of this specification and its documentation is separate from fixture or implementation publication.
