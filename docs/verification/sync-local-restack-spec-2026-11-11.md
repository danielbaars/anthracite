# Sync local-work preservation: specification record

On 11 November 2026 the maintainer approved the scope and public-process test boundary for the [English specification](../specs/sync-local-restack.md).

The bounded change preserves same-parent local-ahead work and conservatively recognized unpublished restacks across verified parent-child relationships. Sync reports pending publication and performs no push or PR edit. Different/uncertain histories retain explicit reconciliation with clearer observations. Get semantics, automatic publication and universal rebase recognition remain outside scope.

The single primary test seam is public CLI processes with real temporary Git repositories and bare remotes, controlling only gh answers. Acceptance includes consecutive syncs, exact commit data, parent-child recognition, real incoming differences, preserving abort, existing option/frozen/worktree/file protections, owned recovery and published-record compatibility. Focused Node/native and installed npm checks plus one existing MCP smoke are planned for implementation.

The [baseline report](sync-local-restack-research-2026-11-11.md) and unchanged raw JSON captures support the problem and recognition limits only. The portable probe adaptations preserve the existing fixture boundary and default to isolated output. They do not constitute an implemented classifier or candidate acceptance.

Specification checks cover the required template, story/acceptance coverage, internal links, evidence hashes, portable-probe syntax and one isolated rerun of the baseline reproduction. No product code, user project, installation or live test PR is changed. CI and the full matrix remain off. Commit and push the canonical documentation/evidence before linking it from the GitHub issue; apply ready-for-agent. No implementation ticket or PR is created in this step.
