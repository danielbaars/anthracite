# Sync abandonment: baseline and agreed acceptance

Specification: [preserving sync abandonment](../specs/sync-abandonment.md), tracked by [#152](https://github.com/danielbaars/anthracite/issues/152). Missing-participant continuation is [#153](https://github.com/danielbaars/anthracite/issues/153), not an implementation prerequisite.

## Published baseline

The public npm 0.6.14 executable reproduced a genuine maintenance rebase conflict on macOS ARM64 with Node 24.19.0. Git repositories and bare remotes were real and temporary; GitHub answers were controlled by the existing external fixture. No live GitHub mutation, installation change or CI run was used. The CLI remained unmodified.

The tested public archive's SHA256 is `44c10ce7e071b64f06a66c1df5c1c7a56d002018629a4df0717e296f333e4849`. The [0.6.14 release](https://github.com/danielbaars/anthracite/releases/tag/v0.6.14) retains the artifact and its publication evidence; its source is `6bf6eed43844cb4d8c01c40e38d9440c84b0237e`.

| Observation                                             | Exit/result                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Real sync restack conflict                              | Exit 1; recovery retained, 9,816 bytes                        |
| `ls`, `log` while pending                               | Exit 1, finish-pending-sync refusal                           |
| `info --branch local-work`, `children`, `pr local-work` | Exit 0 in this fixture; the recovery bytes remained unchanged |
| `delete local-work --force` while pending               | Exit 1, finish-pending-sync refusal                           |
| `sync --abort`                                          | Exit 1, unknown argument                                      |
| Raw Git rebase abort, then `continue`                   | Exit 1, no matching owned active sync rebase                  |
| `ls` after raw abort                                    | Exit 1, finish-pending-sync refusal persists                  |

The minimal trap does not require deleting a branch. The observations establish the exit/inspection defect, not which branches in a user's project should be deleted. Successful baseline inspection was not a complete index/ref preservation audit; the implementation must satisfy that stronger acceptance requirement.

## Retained evidence and reproduction

The [evidence directory](evidence/sync-abandonment-2026-11-09/) contains the unchanged original issue export, original probe and output, a portable probe and its successful output. `SHA256SUMS` covers those unchanged files. The original probe's temporary helper path is historical; use the portable probe to reproduce.

From a checkout built with the pinned tools in [CONTRIBUTING](../../CONTRIBUTING.md), install the exact public baseline into a fresh temporary prefix, then run:

```sh
task_prefix="$(mktemp -d)"
npm install --prefix "$task_prefix" --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org @danielbaars/anthracite@0.6.14
ANTHRACITE_TEST_BINARY="$task_prefix/node_modules/.bin/an" \
  node docs/verification/evidence/sync-abandonment-2026-11-09/probe.cjs
```

The probe asserts the actual version, constructs a real conflict, checks the symptoms and original recovery bytes, then removes its fixture repositories. It permits an explicit `ANTHRACITE_PROBE_FIXTURE_MODULE` pointing to a previously built matching fixture module; the retained run reused one whose source matched this checkout. That override changes test setup only: every observed Anthracite command still executes the separately installed public 0.6.14 binary.

## Approved future acceptance

On 2026-11-09 the owner approved one public-process seam and six grouped scenarios: pending inspection; active/already-aborted abandonment; preservation/reporting of reached effects and local work; ownership/concurrency refusals; interrupted/repeated release and ordinary follow-up guards; published-record, Node/native, npm and one MCP delivery check.

These are requirements for a later implementation. No `sync --abort` implementation, candidate acceptance, general rollback or automatic participant skipping is claimed. The specification keeps full CI off and excludes live GitHub test writes and user-project/installation changes.
