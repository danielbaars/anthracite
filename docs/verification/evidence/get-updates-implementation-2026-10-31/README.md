# Get candidate receipts

These are local source-qualified candidate receipts, not live-service or published-release evidence. [Verification and pending review status](../../get-updates-implementation-2026-10-31.md) summarize the result. Binaries/tarballs remain task-owned outside Git; package metadata remains 0.5.1.

## Revisions and selections

- `4b44a3132968553613881f080591add7919b0cb0`: frozen assembled get source. Raw Node/native205-case reports remain unchanged at190 passing/15 failing. Supporting route/sync/legacy receipts use the same production source.
- `4ae615737a9e3d3a69a3d9e5427175c4b48a3306`: only commands/completion.ts changes in production; focused delivery/completion10/10 per runtime and rebuilt installed8/8. Test-only adaptations in63f73679 pass8/8 without production changes.
- `046e85ad3df4372f099a8e07461d9dc430d34d94`: [reserved core fix report](reserved-fix-report.md) and35/35 focused receipts per runtime. The three business-source files match the subsequent combined source.
- `724e7d75228dbe7f9bd4b8f0a374c10cf3ff4098`: combined source, source manifest and final artifacts. Affected15 + publication5 pass20/20 per runtime; exact installed artifact passes8/8. No unchanged full205/supporting repetition was performed.

[summary.json](summary.json) retains exact compiled-file selections, grep filters, source revisions, all case identities and overlap/supersession accounting. [Initial failure triage](initial-failure-triage.md) distinguishes core issues from justified fixture/compatibility changes. All copied runtime JSON/logs are unchanged; SHA256SUMS verifies the retained files.

The current inventory has263 distinct named passing identities per runtime (118 new get cases,145 existing controls) across the recorded source boundaries. The legacy selection has12 configured executions but9 reported identities because an inherited literal `(${scene})` header repeats three names. One old failing concurrent-actor assumption is replaced by an immutable-plan refusal/preservation control; it is not counted twice. Repeated red/green, corrected-case and installed executions do not create additional feature cases.

## Reproduce

Use pinned Node24.19.0, checked-in Yarn3.2.1, TypeScript5.5.4 and Bun1.3.14:

```sh
node .yarn/releases/yarn-3.2.1.cjs turbo run build
node node_modules/eslint/bin/eslint.js apps/cli/src --quiet --ext .ts --no-cache
node .yarn/releases/yarn-3.2.1.cjs workspace @danielbaars/anthracite check
```

Actual executions use compiled Mocha files from immutable source/test copies. The summary lists all ten initial get files, exact modern route filter, sync files, legacy files/filter, completion files and six merged affected files/filter. Set GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 for inherited legacy fixtures. Explicit local rebase.updateRefs=true tests retain their true setting and prove get's per-command bound. Repeat the selection with ANTHRACITE_TEST_BINARY pointing to the independently compiled native executable.

Build the local package with scripts/build-npm-package.cjs and BUN_EXECUTABLE pointing at the prepared Bun. The first pack attempt hit the default npm cache permission boundary; successful builds use task-owned empty user/global npm config and cache instead of changing owner files. `node scripts/test-npm-package.cjs <exact-local-tarball>` runs the eight-case offline installed gate with disposable HOME/config/cache/prefix. On this host it uses the established local process-supervision permission because the sandbox previously denied ps; no network or owner installation is involved.

## Qualifications

The modern route filter is exactly `get fast-forwards|g fast-forwards`. The unrelated baseline unsupported-absorb sentinel remains a retained0/1 negative receipt, never a passing get case. The post-publication probe/script retain their original immutable75 build and task paths as provenance. Corrected publication tests verify refusal/preservation on the merged build; they do not rewrite that old negative evidence into a pass.

Source manifest hashes and native/tarball identities for each stage are in artifact-identities.json. Only the final merged identities describe the last package gate; older artifacts are not relabeled as the final build. Independent review and any subsequent fixes remain separate work.
