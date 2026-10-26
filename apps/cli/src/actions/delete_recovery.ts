import { assertBranchEditable } from '../lib/engine/frozen_branch';
import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { TContinueConfig } from '../lib/spiffy/continuation_spf';

export function assertDeleteRecoveryEditable(
  recovery: TContinueConfig['data']['delete']
): void {
  if (!recovery) return;
  try {
    for (const branch of recovery.mandatory) assertBranchEditable(branch);
  } catch (error) {
    if (error instanceof Error)
      throw new PreconditionsFailedError(
        `${error.message}\n${recovery.branch} has already been deleted; completed changes are retained. Unfreeze the remaining mandatory survivors before retrying restack or continue.`
      );
    throw error;
  }
}

export function recordDeleteCompletion(
  branch: string,
  context: TContext
): void {
  if (!context.continueConfig.data.delete) return;
  context.continueConfig.update((data) => {
    if (data.delete)
      data.delete.mandatory = data.delete.mandatory.filter(
        (name) => name !== branch
      );
  });
}
