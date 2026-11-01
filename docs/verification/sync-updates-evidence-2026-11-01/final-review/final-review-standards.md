Standards review: `26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd...2dc0c3dfe27e83a9b8d3183600e542d7aef80e0f`.

No hard documented-repository standard violations found. English publication, inherited attribution and compatibility boundaries are preserved. The receipt-only `.gitattributes` exception preserves historical command bytes rather than relaxing source/documentation standards. Explicit user instructions supersede CONTRIBUTING's full-matrix gate.

- **[P3] Possible Speculative Generality — `apps/cli/src/actions/sync/sync_maintenance.ts:56–86`.** The added API declares `readonly progress?: SyncMaintenanceProgress` and updates `options.progress?.completed` / `options.progress?.expected`, but no source or test caller supplies this option. The only caller (`sync_execute.ts:131–139`) records completion through `onComplete`; `completeSyncBranch` already maintains the saved operation and completion expectations. Remove the unused progress type, parameter and snapshot callback, retaining the operation-specific maintenance adapter and existing callback. This eliminates a second, unused progress representation and its extra Git-read implementation. This is a baseline smell judgment, supported by Ponytail's “No abstraction ... option ... nobody asked for” guidance, not a hard repository rule or a demonstrated runtime failure.

All twelve baseline smells were considered; no other actionable smell identified. Repository conventions and KISS take precedence over speculative extraction of necessary guard code. Tool-enforced issues were excluded.

Read-only review; no source edits, tests, tooling checks, CI, full matrix or live service operations were run. Existing acceptance receipts retain their stated runtime/source qualifications.

Count: **1 judgment-call finding (P3); 0 hard violations.**
