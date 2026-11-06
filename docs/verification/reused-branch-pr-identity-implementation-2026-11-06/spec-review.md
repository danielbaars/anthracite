## Spec final recheck

**Both P1 findings resolved; no remaining concrete spec findings.**

Reviewed source correction `f549a7a4` at clean workbranch tip `e0f8a3f52c6649a4f8a6b0c6478e0d55f421ee22`. The merge changes no CLI source relative to the correction. The stable native build used for independent public-CLI reruns matches that source.

- **Confirmation-time input substitution:** the original reproduction now refuses before any push, retains the concurrent local commit and leaves the remote unchanged. Raw head/base refs and selected metadata are checked after target discovery and before each push. Evidence: `/private/tmp/anthracite-139-review-ref-race-final.json`.
- **Post-push metadata loss:** both original reproductions now refuse after the already completed push, preserve the concurrent local description, and retain the valid `alternate` parent instead of replacing it with cached `main`. No stale PR publication follows that lookup. The error explicitly discloses the reached push and unattempted footer work. Evidence: `/private/tmp/anthracite-139-review-postpush-parent-final.json` and `/private/tmp/anthracite-139-review-postpush-metadata-final.json`.

The same input proof is carried through PR reads/effects, creation/status readback, local cache publication and reviewer/assignee reads/effects. Its metadata expectation advances only to the blob returned by the operation's own publication, followed by a raw-state check; it never adopts concurrent metadata as new authority. This addresses the preserving and scoped-publication contract without a format migration or weakened identity checks.

No source edits, builds, CI runs or GitHub writes were performed during this independent recheck.
