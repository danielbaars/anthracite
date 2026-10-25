import { ensureEditorAllowedPrecondition } from '../lib/preconditions';
import chalk from 'chalk';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { RebaseConflictError } from '../lib/errors';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';
import { restackBranches } from './restack';

export function editBranchAction(context: TContext): void {
  ensureEditorAllowedPrecondition(context);
  const currentBranchName = context.engine.currentBranchPrecondition;
  const branchesToRestack = context.engine.getRelativeStack(
    currentBranchName,
    SCOPE.UPSTACK_EXCLUSIVE
  );
  assertBranchesAvailableInWorktrees([currentBranchName, ...branchesToRestack]);

  const result = context.engine.rebaseInteractive(currentBranchName);

  if (result.result === 'REBASE_CONFLICT') {
    persistContinuation(
      {
        branchesToRestack,
        rebasedBranchBase: result.rebasedBranchBase,
      },
      context
    );
    printConflictStatus(
      `Hit conflict during interactive rebase of ${chalk.yellow(
        currentBranchName
      )}.`,
      context
    );
    throw new RebaseConflictError();
  }

  restackBranches(branchesToRestack, context);
}
