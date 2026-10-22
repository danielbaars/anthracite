import { getCurrentBranchName } from '../lib/git/branch_ops';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { DetachedError, PreconditionsFailedError } from '../lib/errors';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';
import { getBranchesToRestack, restackBranches } from './restack';

export function currentBranchOnto(
  ontoBranchName: string,
  context: TContext,
  source = context.engine.currentBranchPrecondition
): void {
  assertNoGitOperation();
  if (!getCurrentBranchName()) throw new DetachedError();
  uncommittedTrackedChangesPrecondition();
  const from = context.engine.getBaseRevision(source);
  context.engine.getRelativeStack(ontoBranchName, SCOPE.BRANCH);
  const branches = context.engine.getRelativeStack(source, SCOPE.UPSTACK);
  if (branches.includes(ontoBranchName)) {
    throw new PreconditionsFailedError(
      `Cannot move ${source} onto itself or a descendant.`
    );
  }
  const changingBranches = getBranchesToRestack(
    branches,
    context,
    from !== context.engine.getRevision(ontoBranchName) ? [source] : []
  );
  assertBranchesAvailableInWorktrees([source, ...changingBranches]);
  assertRestackFilesAvailable({
    branches: changingBranches.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [
      source,
      context.engine.currentBranch ?? source,
      ...(changingBranches.length > 0 ? [ontoBranchName] : []),
    ].map((name) => `refs/heads/${name}`),
    operation: 'move',
  });
  context.engine.checkoutBranch(source, { preserveIgnored: true });
  context.engine.setParent(source, ontoBranchName);
  restackBranches(branches, context);
}
