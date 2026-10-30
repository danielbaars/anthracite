## Standards

Source: clean `115d151c436ae85d4e877af61c627df92d5121f9`; tree `79fe9ed960cd3fdda85f2cb0854f6f1ff4709b2c`. Fixed baseline: `a070dd5ce4890a37a4e6506bb2b2fd50752c5379`. Reviewed `git diff a070dd5ce4890a37a4e6506bb2b2fd50752c5379...HEAD` and connected implementation, continuation, engine, adapters and public fixtures.

Sources: repository `AGENTS.md`, `CONTRIBUTING.md`, `GLOSSARY.md`, `docs/installation.md`, `COMPATIBILITY.md`, CLI TypeScript/ESLint configuration and existing Mocha/subprocess conventions; generic `nvwa-typescript/SKILL.md` where compatible. Applied all twelve mandatory Fowler smell heuristics from `code-review/SKILL.md`. Tooling-enforced issues and explicitly disabled CI/full-matrix work are excluded.

**Documented-standard breaches: none established.** Existing metadata names/continuation formats remain intact; new landing recovery is additive. No dependency or tooling migration appears in this diff.

**Judgement calls (nonblocking):**

1. **Possible Duplicated Code:** `apps/cli/src/lib/api/github_pr.ts:70–77`, `github_review.ts:50–57`, `github_land_policy.ts:16–23` and `github_land_merge.ts:46–53` repeat the same child-process environment and buffer policy: `GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: '', PAGER: ''` and `maxBuffer: 16 * 1024 * 1024`. The first three also duplicate missing-CLI/rate-limit/auth/network classification (`github_pr.ts:81–101`, `github_review.ts:59–79`, `github_land_policy.ts:27–51`), with already different regex coverage. Extract the shared environment/options and classification only; preserve each operation's distinct uncertainty/retry semantics. This meets the generic KISS threshold of three actual uses and needs no transport framework.

2. **Possible Mysterious Name:** `apps/cli/src/actions/land_leaf.ts:111`, `:157`, `:198` name the main entry points `startLandLeaf`, `resumeLandLeaf` and `applyLandLeaf`, but the implementation captures both `plan.merges` and `plan.maintenance` (`:131–132`) and loops across the selected merge chain (`:217`). The diagnostic at `:118` also says “Leaf publication identity”. Rename the module/entry points and diagnostic around scoped landing so a maintainer does not infer a leaf-only operation.

Total: 0 hard breaches; 2 optional smell findings. No repository writes, test runs, remote actions or publication performed during review.
