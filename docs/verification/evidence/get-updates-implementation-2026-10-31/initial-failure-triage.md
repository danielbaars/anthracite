# Assembled integration failure triage

Frozen production: 4b44a3132968553613881f080591add7919b0cb0, business source integrated through #75. Both runtimes select 205 cases with 190 passes and 15 failures; identical failing identities. Raw receipts remain unchanged.

- Five real conflict/queued-import failures: get_recovery.ts assertGetHookParticipants iterates planned frozen maintenance entries before selected imports are applied; readMetadataRef on an absent future branch is not frozen, so it falsely reports expanded replay authority. Two frozen get cases, two mixed-author import cases and one newly tracked queued-import case fail before reaching the intended conflict. This requires a production guard fix; do not weaken these tests.
- One strict external gh fixture omission: old GetFixture supports numeric PR2 but not stored PR1; pinned PR associations now request 1. Add the valid numeric1 mapping without broadening unsupported responses.
- Two old no-replay head assertions: frozen-force descendants and divergent-retarget force assert exact old/local histories; add explicit --no-restack while retaining those assertions.
- Three old terminal-failure follow-up expectations: navigation/automatic retry after reached ambiguous checkout/ref-lock/import publication now meet the approved owned manual-inspection boundary. Preserve primary protection/effects checks and strengthen follow-up assertions to nonzero plus unchanged refs/index/files/recovery. Do not clear intent, reset refs or automatically restart.
- Four error wording expectations: malformed recovery, force checkout redirect, remote and trunk phase names. Update only the specific new reason/phase fragments, retaining independent actual-state checks.

The independently reserved post-publication metadata probe remains an additional open root review/fix item, not part of these passing selected cases.
