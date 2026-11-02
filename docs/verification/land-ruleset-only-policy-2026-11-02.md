# Ruleset-only landing policy repair verification

Date: 2026-11-02. Status: locally verified source candidate, not a published release. Published npm 0.6.1 does not contain this repair.

## Problem and bounded behavior

A ruleset-only branch can report `protected: true` while the classic protection endpoint returns `Branch not protected` (HTTP 404). The previous reader rejected that legitimate combination before evaluating the available ruleset requirements.

The repair preserves that refusal unless the classic response has the observed structured 404 body and matching gh status, active rulesets explain protected status, and a separate read-only GraphQL response proves absence. The proof requires the exact configured repository and branch, administrator visibility, explicit null `branchProtectionRule` and no GraphQL errors. It accepts neither an omitted field nor a hidden/unavailable policy. Existing classic policies retain their canonical URL validation and combine with rulesets using the stricter review count and the union of checks and publishers.

## Red/green evidence

The first new public-CLI test failed before the production change with the reported classic-protection error and exit 1. The same test passed after the repair. The final selection passed 20 distinct cases on Node 24.19.0 and the macOS ARM64 Bun 1.3.14 native candidate (40 final passes, zero failures).

The 14 new cases cover approved ruleset-only preview, retained required approval, combined classic/ruleset reviews and checks, inaccessible evidence, non-admin visibility, foreign repository, foreign branch, a present classic rule, omitted null evidence, partial data with GraphQL errors, ambiguous 403 and 404 responses, unexplained protected status and actual fixture landing with mandatory successor preservation. Refused and read-only cases compare opaque local state and remote refs before and after.

The six retained cases cover classic repository identity, app-bound classic publisher checks, unavailable ruleset publisher evidence, complete rule pagination and unknown classic protection, later readiness requirements, and malformed classic payloads.

The candidate also successfully read a real ruleset-only repository policy through the repaired adapter using genuine read-only GitHub REST and GraphQL responses: one required approval, no required status checks and no policy blocker. That probe ran outside the application checkout and did not invoke landing or perform any Git operation there. It establishes policy parsing, not the readiness or authorization of any real PR.

## Checks and limits

- CLI TypeScript build and no-emit typecheck: pass.
- Changed production/test source lint, Prettier and whitespace check: pass.
- Source selection and native binary identities: retained in [results](evidence/land-ruleset-only-policy-2026-11-02/results.json).
- No application checkout was accessed or modified during the repair. No active installation or shell/MCP configuration changed.
- No GitHub writes, publication, CI or full matrix were performed. Landing application tests used real temporary Git repositories/bare remotes with controlled GitHub answers.

The fallback deliberately requires administrator-visible proof and a specific structured classic 404. Less privileged access, a different error shape or an unreadable ruleset API still blocks. This repair does not resolve private-repository account-plan restrictions. It changes no merge method, review/check requirement, branch scope, stored format or recovery authority.
