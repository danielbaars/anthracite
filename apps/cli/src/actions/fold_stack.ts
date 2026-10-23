import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';

/** Collapse one aligned linear chain into its chosen surviving name. */
export function foldStack(keep: boolean, context: TContext): void {
  assertNoGitOperation('fold');
  const departure = context.engine.currentBranchPrecondition;
  uncommittedTrackedChangesPrecondition();
  const chain: string[] = [];
  let branch = departure;
  while (!context.engine.isTrunk(branch)) {
    if (chain.includes(branch))
      throw new PreconditionsFailedError('Invalid fold parent chain.');
    chain.unshift(branch);
    branch = context.engine.getParentPrecondition(branch);
  }
  if (chain.length === 0)
    throw new PreconditionsFailedError('Cannot fold trunk.');
  branch = departure;
  while (context.engine.getChildren(branch).length > 0) {
    const children = context.engine.getChildren(branch);
    if (children.length !== 1) {
      throw new PreconditionsFailedError(
        'Stack fold requires a unique tip; multiple tips are not supported yet.'
      );
    }
    branch = children[0];
    context.engine.getBaseRevision(branch);
    chain.push(branch);
  }
  for (const name of chain) {
    const parent = context.engine.getParentPrecondition(name);
    if (!context.engine.isBranchFixed(name)) {
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: needs restack. Run ch checkout '${name.replace(
          /'/g,
          "'\\''"
        )}' and ch restack before retrying fold --stack.`
      );
    }
    if (
      context.engine.getChildren(name).some((child) => !chain.includes(child))
    ) {
      throw new PreconditionsFailedError(
        'Stack fold with fan-out is not supported yet.'
      );
    }
    if (context.engine.getPrInfo(name)?.number !== undefined) {
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: it has a locally known PR association. PR-aware stack fold is not supported.`
      );
    }
    if (
      context.engine.getBaseRevision(name) !==
      context.engine.getRevision(parent)
    ) {
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: needs restack. Run ch restack before retrying.`
      );
    }
  }
  const tip = chain[chain.length - 1];
  const survivor = keep ? tip : chain[0];
  if (chain.length === 1) return;
  assertBranchesAvailableInWorktrees(chain);
  assertRestackFilesAvailable({
    branches: [],
    checkoutRevisions: [tip, departure].map((name) => `refs/heads/${name}`),
    skipTrackedPaths: true,
    operation: 'fold',
  });
  context.engine.foldStack(chain, survivor);
  context.splog.info(`Folded stack into ${survivor}.`);
}
