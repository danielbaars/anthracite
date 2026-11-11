# Unpublished sync history: implementation verification

Candidate for #171 and #172–#175, based on npm 0.7.0 source `4fc0fa51a3f374c4346842d27aa0daee82baf3dc`. This record does not claim a new published npm version.

## Contract

Sync retains same-parent local commits that contain the verified remote history. It also recognizes a deliberately bounded equivalent local restack: supported linear own-commit sequences, exact author identity/time, complete message bytes and exact per-commit changes. Object IDs and committer timestamps may differ. Rewritten-parent child recognition requires the exact already-verified remote/local parent-head pairing.

Preserved heads remain part of the captured source graph and guards. Sync performs required local maintenance and reports pending publication; it does not push or edit PRs. Other eligible arms still refresh. Uncertain, amended, unsupported or newly changed histories retain explicit reconciliation. Get keeps its existing contract.

Recognition is bounded to 128 commits per history, 4 MiB of proof output and three seconds per proof. Missing/unsupported evidence or exhausted bounds means uncertainty, never assumed equivalence. Git replacement/graft ancestry, lossy message decoding, relative diff presentation and hidden submodule differences cannot establish preservation. Conservative patches can reject a valid contextual replay. Merge commits, extra commit headers (including signatures) and unsupported encoding shapes also retain reconciliation rather than guessing equivalence.

## Recovery

The optional sync-only `refresh.preserved` field records decisions without dropping sources or widening the get schema. Existing strict published 0.7.0 readers refuse an unsupported preservation record while leaving its bytes, refs, index, files and source pins unchanged. Candidate continuation then completes that same record. Actual unmodified published 0.7.0 records retain their original explicit REBASE/OVERWRITE decisions. No mandatory branch-metadata migration or recovery-version change was needed.

Finish pending workflows with the supporting candidate before downgrading. A downgrade does not undo completed Git effects.

## Acceptance ledger

The primary boundary is public CLI processes using real temporary Git repositories and bare remotes; only gh responses are controlled. Assertions inspect refs, commit data, metadata, checkout, index/files, source pins/recovery and independent remote receipts.

- #172: 11 focused cases on Node and native; the final display-label-only commit also has two exact-source tracers on each runtime.
- #173: 26 new cases plus three existing canonical-ancestry/merged-parent controls on each runtime. The final no-grafts environment pin has focused six-case Node and thirteen-case native follow-up coverage.
- #174: 17 unique recovery workflows on each runtime, plus an existing get-continuation control. The integrated recovery tracer is separately retained.
- #175: 14 unique cases on each runtime across the functional campaign and final debug delta. The final artifact passes all 25 selected package scenarios, the second-command alias control and four additional installed uncertainty/recovery/MCP/debug cases.

Counts above are per slice and include overlapping controls; they must not be summed as distinct end-to-end acceptance. Failed attempts and retries are retained separately. Initial campaigns encountered command timeouts under concurrent fixture work and one transient native fixture repository-detection failure. Unchanged sequential retries passed; this record does not assert a proven underlying cause or an unrelated baseline defect.

## Source and installed artifact

The final tested implementation source is `f954138179ef20a70efcaedf8994fd3987506621`. Integration merge `6eb2439df0bf72d360d255f4c55f910a223ac630` has the same complete source tree before this verification document is added. The final candidate tarball SHA-256 is `5048b7668a07ae1ddb5813cb1b89de9694d5682613077c6624f918d6ddfd3fb7`; installed `cli.cjs` SHA-256 is `779c7c7fbac626471b7eef9a22a874d6fb1572a1879db423092218e8666e4ec1`. Node 24.19.0 and Bun 1.3.14 were used. No npm version was published.

The 13 functional paired-chain cases precede only the final debug reporting change; the additional debug negative/matching control and native core repeat cover that delta. The final artifact was rebuilt afterward and used for the complete installed checks. The package runner contains the short consecutive-sync case; the four additional installed cases provide uncertainty, genuine continuation, existing SDK MCP delivery and debug disclosure without extending its existing subprocess budget.

The first package attempt had 23 passes and two failures. The numeric-zero MCP test failed before cancellation because the sandbox denied `ps` in its owned hook; the unchanged scoped control and complete package runner passed outside that sandbox. The other sync command timed out at 15 seconds and passed on unchanged isolated and complete retries; its root cause is not asserted. No source or timeout change was made to turn either control green.

## Retained evidence

[Curated evidence](sync-local-restack-implementation-evidence-2026-11-11/) includes unchanged per-slice summaries, selected red/green process receipts, original candidate/published recovery records and final installed-artifact results. `SHA256SUMS` verifies copied source bytes; `provenance.json` records their original local sources. Auxiliary receipt filenames retained in summaries describe the local campaigns; they are not all additional repository files. Counts overlap and successful retries are not additional unique scenarios.

The [approved specification](../specs/sync-local-restack.md) and [npm 0.7.0 baseline research](sync-local-restack-research-2026-11-11.md) retain their original boundaries. Independent review results and the exact-head inexpensive CI disposition are recorded in [PR #176](https://github.com/danielbaars/anthracite/pull/176), separately from local artifact acceptance.

## Publication boundary

One implementation PR only. Ordinary inexpensive CI may run; the full validation matrix remains off. No live GitHub fixture writes, user-project changes, active-installation changes or npm publication belong to this acceptance.
