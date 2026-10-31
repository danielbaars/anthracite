import { getCurrentBranchName, switchBranch } from '../../lib/git/branch_ops';
import { ExitFailedError } from '../../lib/errors';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { getSha, getShaOrThrow } from '../../lib/git/get_sha';

export type GetCheckoutIdentity =
  | { readonly branchName: string }
  | { readonly detachedOid: string };

export type GetCheckoutIntent = {
  readonly target: string;
  readonly original: GetCheckoutIdentity;
  readonly shouldCheckout: boolean;
};

export function captureGetCheckout(): GetCheckoutIdentity {
  const branchName = getCurrentBranchName();
  return branchName ? { branchName } : { detachedOid: getShaOrThrow('HEAD') };
}

export function finishGetCheckout(
  intent: GetCheckoutIntent,
  updatedBranches: readonly string[]
): void {
  const destination = intent.shouldCheckout
    ? { branchName: intent.target }
    : intent.original;
  const description =
    'branchName' in destination
      ? destination.branchName
      : `detached ${destination.detachedOid}`;
  try {
    if ('branchName' in destination) {
      if (!getSha(`refs/heads/${destination.branchName}`))
        throw new Error(
          `Original or target branch ${destination.branchName} no longer exists.`
        );
      assertBranchesAvailableInWorktrees([destination.branchName]);
      if (getCurrentBranchName() !== destination.branchName)
        switchBranch(destination.branchName, {
          preserveIgnored: true,
          noGuess: true,
        });
      if (
        getCurrentBranchName() !== destination.branchName ||
        getShaOrThrow('HEAD') !== getSha(`refs/heads/${destination.branchName}`)
      )
        throw new Error(
          'The checkout changed while selecting the final branch.'
        );
    } else {
      if (
        getCurrentBranchName() ||
        getShaOrThrow('HEAD') !== destination.detachedOid
      )
        switchBranch(destination.detachedOid, {
          detach: true,
          preserveIgnored: true,
        });
      if (
        getCurrentBranchName() ||
        getShaOrThrow('HEAD') !== destination.detachedOid
      )
        throw new Error(
          'The checkout changed while restoring the detached commit.'
        );
    }
  } catch (error) {
    const actual = getCurrentBranchName() ?? 'detached HEAD';
    throw new ExitFailedError(
      `${
        updatedBranches.length > 0
          ? `Updated ${updatedBranches.join(', ')} before get stopped. `
          : ''
      }Final checkout of ${description} failed.\nActual checkout: ${actual} (${getShaOrThrow(
        'HEAD'
      )}).\n${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function assertGetCheckout(intent: GetCheckoutIntent): void {
  const destination = intent.shouldCheckout
    ? { branchName: intent.target }
    : intent.original;
  const actual = captureGetCheckout();
  if (
    'branchName' in destination
      ? !('branchName' in actual) ||
        actual.branchName !== destination.branchName ||
        getShaOrThrow('HEAD') !== getSha(`refs/heads/${destination.branchName}`)
      : !('detachedOid' in actual) ||
        actual.detachedOid !== destination.detachedOid
  )
    throw new Error('The checkout changed after selecting the final identity.');
}
