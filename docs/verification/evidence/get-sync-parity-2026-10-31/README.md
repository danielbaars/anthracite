# Get/sync research evidence

Read [the research report](../../get-sync-parity-2026-10-31.md) first. [The ledger](ledger.json) indexes 35 actual scenario-command observations; three initial native-unsubmitted cases and six separate [controlled-gh observations](controls/offline-an-results.md) are not folded into normalized live acceptance. Help, setup and diagnostics remain separate.

[Inventory](inventory.json) records byte-identical retained copies and their hashes. Original temporary paths inside receipts are provenance; durable relative paths are indexed here. Native baseline synchronization and the two normal remote-child fast-forwards are retained in setup/github. Independent [core](audits/live-audit.md) and [cleanup](audits/cleanup-live-audit.md) audits retain qualifications.

Run `node docs/verification/evidence/get-sync-parity-2026-10-31/check.cjs` from the repository root to check retained hashes, observation identities and the decisive cleanup/lifecycle facts. This does not rerun either CLI. The one-off [fixture helpers](harness/) are procedural evidence, not an idempotent reusable test suite; do not rerun them against the completed fixtures. Real-gh authentication used a transparent wrapper restoring HOME only for credential lookup; private CLI configuration and credential copies are excluded.

Diagnostics include missing isolated auth, bare-remote repository inference and credential-helper failures/timeouts; these are setup failures, not product parity findings. The later successful native captures use corrected authentication/transport. No disassembler target was opened. Selected REA filesystem snapshots and sampled processes retain their recorded coverage limits.
