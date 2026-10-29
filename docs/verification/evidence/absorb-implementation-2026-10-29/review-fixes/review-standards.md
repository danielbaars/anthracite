## Standards

Reviewed `966877d4c382560c58d31a3ea9623705c57dbb83...277692214090229416610d7716f5ef265181a6db` against AGENTS.md, CONTRIBUTING.md, COMPATIBILITY.md, docs/installation.md, the applicable TypeScript guardrails, Ponytail and the Fowler baseline. Existing Mocha/public real-Git fixtures, historical names and synchronous Git boundaries were treated as repository conventions. Tool-enforced formatting, lint and type rules were excluded.

No material documented-standard breach found.

- **[P3] Possible Duplicated Code — centralize the Git-redirection variable list.** `apps/cli/src/lib/git/absorb_guard.ts:39`, `apps/cli/src/lib/git/restack_files.ts:26` and `apps/cli/src/lib/git/worktrees.ts:30` each repeat `for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete env[key]`, while `apps/cli/src/actions/absorb_git.ts:7` owns another copy used by initial refusal, continuation and generated restoration. This is the same safety policy in four independently maintained places: adding a supported override can update refusal/restoration without updating hook-side source inspection. Move only the shared readonly variable list into a dependency-neutral Git module and import it at these sites; preserve each caller's current conditional behavior. This is a Fowler judgement call, not a hard violation or a demonstrated current redirection defect; it also meets the TypeScript skill's three-real-call-sites threshold for extraction.

Summary: 1 judgement finding, 0 hard violations. Read-only review; no tests, network, CI or Git mutations were performed. Generated historical captures were sampled through their manifests/report rather than exhaustively read.
