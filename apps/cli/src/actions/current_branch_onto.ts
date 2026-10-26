import { getCurrentBranchName } from '../lib/git/branch_ops';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { DetachedError, PreconditionsFailedError } from '../lib/errors';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';
import { getBranchesToRestack, restackBranches } from './restack';
import { clearContinuation } from './persist_continuation';

export function currentBranchOnto(
  ontoBranchName: string,
  context: TContext,
  opts: { source?: string; only?: boolean } = {}
): void {
  const source = opts.source ?? context.engine.currentBranchPrecondition;
  context.engine.assertBranchEditable(source);
  const only = opts.only ?? false;
  assertNoGitOperation();
  const departure = getCurrentBranchName();
  if (!departure) throw new DetachedError();
  uncommittedTrackedChangesPrecondition();
  const oldParent = context.engine.getParentPrecondition(source);
  context.engine.getRelativeStack(ontoBranchName, SCOPE.BRANCH);
  const branches = context.engine.getRelativeStack(source, SCOPE.UPSTACK);
  // Detaching every original child makes a non-self descendant target acyclic.
  if (
    source === ontoBranchName ||
    (!only && branches.includes(ontoBranchName))
  ) {
    throw new PreconditionsFailedError(
      `Cannot move ${source} onto itself${only ? '' : ' or a descendant'}.`
    );
  }
  const children = only ? [...context.engine.getChildren(source)] : [];
  const queue = only ? [...branches.slice(1), source] : branches;
  const parents = new Map([
    ...children.map((child) => [child, oldParent] as const),
    [source, ontoBranchName] as const,
  ]);
  const changingBranches = getBranchesToRestack(queue, context, { parents });
  for (const name of new Set([source, ...children, ...changingBranches]))
    context.engine.assertBranchEditable(name);
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
    skipTrackedPaths: true,
    operation: 'move',
  });
  const mandatory = [...new Set([source, ...children, ...changingBranches])];
  children.forEach((child) =>
    context.engine.setParent(child, oldParent, mandatory)
  );
  context.engine.setParent(source, ontoBranchName, mandatory);
  context.continueConfig.update((data) => {
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
    data.move = {
      source,
      only,
      returnBranch: departure,
      mandatory,
      completed: [],
    };
  });
  restackBranches(queue, context);
  clearContinuation(context);
}
