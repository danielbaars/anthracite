import { PreconditionsFailedError } from '../errors';
import { readMetadataRef } from './metadata_ref';

/** Read from Git so external editors/hooks cannot leave a stale writable cache. */
export function assertBranchEditable(branchName: string): void {
  if (readMetadataRef(branchName).frozen === true)
    throw new PreconditionsFailedError(
      `Cannot modify frozen branch ${branchName}. Run ch unfreeze ${branchName} first.`
    );
}
