import { PreconditionsFailedError } from '../errors';
import { readMetadataRef } from './metadata_ref';
import { TContinueConfig } from '../spiffy/continuation_spf';

/** Read from Git so external editors/hooks cannot leave a stale writable cache. */
export function assertBranchEditable(branchName: string): void {
  if (readMetadataRef(branchName).frozen === true)
    throw new PreconditionsFailedError(
      `Cannot modify frozen branch ${branchName}. Run an unfreeze ${branchName} first.`
    );
}

/** Mandatory structural queues cannot become generic frozen skips on resume. */
export function assertContinuationBranchesEditable(
  data: TContinueConfig['data'],
  active?: string
): void {
  const role = data.move ?? data.fold ?? data.insert ?? data.reorder;
  if (!role) return;
  const remaining = [
    ...new Set([...(active ? [active] : []), ...getMandatoryBranches(data)]),
  ].filter((name) => !role.completed.includes(name));
  for (const name of remaining) {
    if (readMetadataRef(name).frozen !== true) continue;
    throw new PreconditionsFailedError(
      `Cannot modify frozen branch ${name}. Run an unfreeze ${name} first. ` +
        'Structural operation is incomplete. Parent changes and completed restacks remain. ' +
        `Completed branches: ${role.completed.join(', ') || 'none'}. ` +
        `Remaining branches: ${remaining.join(', ') || 'none'}.`
    );
  }
}

export function getMandatoryBranches(data: TContinueConfig['data']): string[] {
  if (data.delete) return [...data.delete.mandatory];
  const role = data.move ?? data.fold ?? data.insert ?? data.reorder;
  if (!role) return [];
  const names =
    data.reorder?.pending ??
    data.insert?.mandatory ??
    data.move?.mandatory ??
    data.fold?.mandatory ??
    data.branchesToRestack;
  return names.filter((name) => !role.completed.includes(name));
}
