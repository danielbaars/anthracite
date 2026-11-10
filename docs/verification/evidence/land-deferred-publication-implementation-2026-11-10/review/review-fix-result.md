# Deferred landing specification review fix

Complete on isolated branch `implement-deferred-land-delivery` in `/private/tmp/anthracite-169-20261110`, clean HEAD `6783ac2e0f94ddd1351b9599aa8c71b653c7f9cc`.

The branch fast-forwarded onto reviewed integration `b8e4188b1cb9f3c8e223f1f42cce24e701d4ac76` before work. Latest integration merged before handoff: already up to date.

## Finding and bounded correction

Addresses the sole Spec P2 in `review-spec.md`. When fresh inspection confirms the current saved target merged externally while durable phase still awaits that merge, formatting derives the immediate next unmerged target from the verified cleanup-only set. That target is labelled publication due, its mandatory push/base/footer work is immediate, and readiness is PENDING until that maintenance and fresh checks complete. The maintenance section says `After confirmed merge`, and debug uses the same fresh cleanup-only and publication labels. Ordinary deferred saved plans retain next-only readiness and deferred later targets.

This is presentation-only. `inspectPendingReadiness`, publication scheduling, merge execution, durable v1/v2 recovery records and recovery ownership guards are unchanged. No synthetic phase is written to or substituted for the durable record. Private formatting helpers share the derived labels; existing function size and parameter limits are respected.

## Public CLI TDD and acceptance

- `review-fix-red-node.json`: **0/1**, expected failure against the incorrect deferred target label before the implementation (26531ms).
- New public regression creates a real paused three-PR landing, externally merges the current PR using controlled gh state plus actual bare-remote trunk advance, verifies the later reached local/remote head mismatch, then compares a preserving dry-run with declined ordinary confirmation. Default/debug text must disclose due publication and conditional readiness. Opaque snapshots, refs, files/index and recovery bytes are preserved; no push/PR edit/merge occurs during inspection.
- Existing resumed presentation case is strengthened to require PENDING and reject READY after its current target is externally merged; it still explicitly resumes and completes the remaining work through unchanged execution.
- `review-fix-green-node.json`: **2/2**, new externally merged regression plus strengthened existing resumed-plan case (72828ms).
- `review-fix-regular-node.json`: **1/1**, unchanged regular deferred preserving saved-plan case (29990ms).
- `review-fix-native.json`: **3/3**, the same three cases on immutable final native (90692ms).
- `review-fix-installed.json`: **2/2**, new preserving externally merged case plus existing real SDK MCP three-PR preview/pause/reconnect/resume and actual push counts on the rebuilt isolated npm candidate (77533ms).

The above are focused overlapping runtime campaigns, not new distinct-scenario totals. New regression count is one. No full suite/matrix was run.

## Static and artifact evidence

TypeScript build/typecheck, source/new-plan-test ESLint, Prettier and `git diff --check` pass. The existing `land_resume_display_cli.test.ts` suite callback exceeds max-lines before this correction too: baseline240 lines versus242 after two stronger assertions. `review-fix-existing-lint-baseline.txt` records that unchanged inherited lint category; no broad refactor or blanket suppression was added.

`review-fix-artifacts.json` binds source6783ac2e, Node24.19.0/Bun1.3.14 and final native/tarball/installed-CLI SHA256 values. The candidate keeps workspace version0.6.15 and is separate from the published producer and active user installation. Build/install logs and process-generated JSON are retained under `review-fix-*`; `review-fix-SHA256SUMS` covers the receipts.

No source guidance, workflow, configuration, dependency, package version, publication authority or active installation was changed. No pushes, PR/issue mutations, CI, live GitHub fixtures or user-project writes. Parent owns integration, independent review rechecks and publication.
