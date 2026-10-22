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
  opts: { source?: string; only?: boolean } = {}
): void {
  const source = opts.source ?? context.engine.currentBranchPrecondition;
  const only = opts.only ?? false;
  assertNoGitOperation();
  if (!getCurrentBranchName()) throw new DetachedError();
  uncommittedTrackedChangesPrecondition();
  const oldParent = context.engine.getParentPrecondition(source);
  context.engine.getRelativeStack(ontoBranchName, SCOPE.BRANCH);
  const branches = context.engine.getRelativeStack(source, SCOPE.UPSTACK);
  if (branches.includes(ontoBranchName)) {
    throw new PreconditionsFailedError(
      `Cannot move ${source} onto itself or a descendant.`
    );
  }
  const children = only ? [...context.engine.getChildren(source)] : [];
  const queue = only ? [...branches.slice(1), source] : branches;
  const parents = new Map([
    ...children.map((child) => [child, oldParent] as const),
    [source, ontoBranchName] as const,
  ]);
  const changingBranches = getBranchesToRestack(queue, context, { parents });
  assertBranchesAvailableInWorktrees([
    source,
    ...children,
    ...changingBranches,
  ]);
  assertRestackFilesAvailable({
    branches: changingBranches.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [
      source,
      context.engine.currentBranch ?? source,
      ...(changingBranches.length > 0
        ? [ontoBranchName, ...(only ? [oldParent] : [])]
        : []),
    ].map((name) => `refs/heads/${name}`),
    operation: 'move',
  });
  children.forEach((child) => context.engine.setParent(child, oldParent));
  context.engine.setParent(source, ontoBranchName);
  try {
    restackBranches(queue, context);
  } catch (error) {
    if (only && context.engine.rebaseInProgress()) {
      const branch = context.engine.getRebaseHead();
      const phase =
        branch === source
          ? 'source phase'
          : branch
          ? 'left-behind child phase'
          : 'rebase phase';
      context.splog.warn(
        `Move only ${source} is incomplete in the ${phase} (${
          branch ?? 'unknown branch'
        }). Parent changes and completed restacks remain; resolve and run ch continue to finish the remaining branches and return to your departure checkout.`
      );
    }
    throw error;
  }
}
