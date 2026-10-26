import chalk from 'chalk';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { ExitFailedError } from '../lib/errors';
import { getBranchesToRestack, restackBranches } from './restack';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { clearContinuation } from './persist_continuation';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';

type TDeleteArgs = { branchName: string; force?: boolean };

/** Deletion may remove a frozen target, but surviving mandatory edits may not. */
export function assertDeleteAllowed(
  args: TDeleteArgs,
  context: TContext
): void {
  if (context.engine.isTrunk(args.branchName)) {
    throw new ExitFailedError('Cannot delete trunk!');
  }
  if (!args.force && !isSafeToDelete(args.branchName, context).result) {
    throw new ExitFailedError(
      [
        `The branch ${args.branchName} is neither merged nor closed.  Use the \`--force\` option to delete it.`,
        `Note that its changes will be lost, as its children will be restacked onto its parent.`,
      ].join('\n')
    );
  }
  const plan = getDeleteSurvivors(args.branchName, context);
  for (const branch of plan.mandatory)
    context.engine.assertBranchEditable(branch);
  if (plan.replay.length) assertNoGitOperation('delete');
  assertBranchesAvailableInWorktrees([args.branchName, ...plan.replay]);
}

export function getDeleteSurvivors(
  branchName: string,
  context: TContext,
  deleting: readonly string[] = [branchName]
): { mandatory: string[]; replay: string[] } {
  const upstack = context.engine.getRelativeStack(branchName, SCOPE.UPSTACK);
  const removed = new Set(
    deleting.filter((branch) => upstack.includes(branch))
  );
  const descendants = upstack.filter(
    (branch) => branch !== branchName && !removed.has(branch)
  );
  const parents = new Map<string, string>();
  for (const branch of descendants) {
    const parent = context.engine.getParentPrecondition(branch);
    let survivor = parent;
    while (removed.has(survivor))
      survivor = context.engine.getParentPrecondition(survivor);
    if (parent !== survivor) parents.set(branch, survivor);
  }
  const replay = getBranchesToRestack(descendants, context, { parents });
  return { mandatory: [...new Set([...parents.keys(), ...replay])], replay };
}

export function deleteBranchAction(args: TDeleteArgs, context: TContext): void {
  assertDeleteAllowed(args, context);
  const branchesToRestack = context.engine.getRelativeStack(
    args.branchName,
    SCOPE.UPSTACK_EXCLUSIVE
  );
  const plan = getDeleteSurvivors(args.branchName, context);
  const mandatory = plan.mandatory;
  const departure = context.engine.currentBranch;
  context.engine.deleteBranch(
    args.branchName,
    () => {
      try {
        for (const branch of mandatory)
          context.engine.assertBranchEditable(branch);
        assertDeleteAllowed(args, context);
      } catch (error) {
        if (
          context.engine.currentBranch !== departure &&
          error instanceof Error
        )
          throw new ExitFailedError(
            `${error.message}\nChecked out ${context.engine.currentBranch}; ${args.branchName} has not been deleted. Completed metadata changes are retained.`
          );
        throw error;
      }
    },
    mandatory
  );
  context.splog.info(`Deleted branch ${chalk.red(args.branchName)}`);
  if (plan.replay.length === 0) return;
  context.continueConfig.update((data) => {
    data.delete = { branch: args.branchName, mandatory };
    data.branchesToRestack = [...branchesToRestack];
    data.branchesToSync = [];
  });
  restackBranches(branchesToRestack, context);
  clearContinuation(context);
}

// Where did we merge this? If it was merged on GitHub, we see where it was
// merged into. If we don't detect that it was merged in GitHub but we do
// see the code in trunk, we fallback to say that it was merged into trunk.
// This extra check (rather than just saying trunk) is used to catch the
// case where one feature branch is merged into another on GitHub.
export function isSafeToDelete(
  branchName: string,
  context: TContext
): { result: true; reason: string } | { result: false } {
  const prInfo = context.engine.getPrInfo(branchName);

  const reason =
    prInfo?.state === 'CLOSED'
      ? `${chalk.redBright(branchName)} is closed on GitHub`
      : prInfo?.state === 'MERGED'
      ? `${chalk.green(branchName)} is merged into ${chalk.cyan(
          prInfo?.base ?? context.engine.trunk
        )}`
      : context.engine.isMergedIntoTrunk(branchName)
      ? `${chalk.green(branchName)} is merged into ${chalk.cyan(
          context.engine.trunk
        )}`
      : context.engine.isBranchEmpty(branchName)
      ? `${chalk.yellow(branchName)} is empty`
      : undefined;

  return reason ? { result: true, reason } : { result: false };
}
