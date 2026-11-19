# Effective landing replay configuration — issue #217

## Boundary and baseline

The candidate starts at `5b5ce385c50d2cf0912ffe0be394c9123b40dd1c` (npm 0.9.4). Tests invoke public CLI processes in real disposable Git repositories and bare remotes. Only GitHub responses are controlled at the existing `gh` boundary. No user project, active installation or actual global Git configuration was changed. No Actions workflow was dispatched.

The first regression failed on the original code: global `rerere.enabled=true` and `rebase.updateRefs=true` overrode neither repository-local false value in Git, but replay inspection rejected the earlier global entries anyway. A second red test demonstrated that the same settings incorrectly blocked a leaf whose only replay happens on GitHub.

## Correction

- Read configuration with scope and origin, retaining the final effective entry for each scalar replay setting. Ask Git to normalize the supported boolean controls.
- Load source-local replay configuration only when the planned simulation reaches an actual local survivor rebase. Keep GitHub replay defaults separate.
- Name unsupported effective controls and their scope/origin. Do not echo arbitrary invalid boolean contents. Retain conservative refusal for actual local replay with active automatic ref updates or recorded resolutions.
- Explicitly disabled rerere ignores retained resolution caches. An unset setting with an existing cache is reported as implicit rerere use. Git documents this behavior in its [configuration reference](https://git-scm.com/docs/git-config/2.43.6#Documentation/git-config.txt-rerereenabled).
- Bind resolution-cache presence to the preserving first-effect input digest. A separate red race test showed that creating that cache after inspection otherwise went unnoticed; the correction refuses before any merge request.
- Preserve existing configuration/attribute isolation, branch-conditional include refusal, leases and first-effect guards. No recovery format or source configuration is migrated.

## Acceptance

The twelve new scenarios cover effective local, worktree, command and included-file precedence; supported false spellings; inactive autoupdate; active and malformed control diagnostics; old/implicit caches; late cache creation; an actual leaf landing; an actual three-PR landing; and preservation of unrelated refs and source configuration.

The first complete Node/native runs used the implemented behavior before a wording-only refinement of the refusal guidance. After that refinement, all three affected diagnostic cases were rerun on the final Node, native and installed npm artifacts. The same final runtime cohorts also reran existing conflict, local/server text behavior, checkout-dependent include, source-hook and changed-configuration controls.

The isolated npm bundle is a development candidate labelled 0.9.4 by the unchanged manifest, not a published release. Its first five cases include an actual leaf landing and the existing MCP client discovering learning and executing preview/retry through the same installed CLI. The final wording check adds implicit-cache refusal and repeats both active-control refusals.

Retained JSON reports are in [the evidence directory](evidence/land-effective-config-2026-11-19/). All twelve new scenarios passed on each runtime. Each final runtime cohort passed twelve cases: the three repeated diagnostic cases plus nine existing controls. This gives 21 distinct scenarios per runtime. Five initial installed-package cases and three final diagnostic checks passed (six distinct npm/MCP scenarios). There were no failures or pending cases. The [summary](evidence/land-effective-config-2026-11-19/summary.json) records durations and final artifact hashes.

TypeScript compilation, targeted ESLint, Prettier, `git diff --check` and local `actionlint` validation passed. Ordinary CI gains only the fast preserving override case; no CI run or full matrix was started.

Active unsupported settings are still intentionally refused when local replay is necessary. This fix does not add a rerere simulator or authorize automatic rewrites of unrelated refs. Existing saved landings retain their execution path.
