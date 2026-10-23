import chalk from 'chalk';
import { TContext } from '../lib/context';
import {
  NoGraphiteContinue,
  RebaseCheckoutError,
  RebaseConflictError,
} from '../lib/errors';
import { clearContinuation, persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';
import { getBranchesToRestack, restackBranches } from './restack';
import { getBranchesFromRemote } from './sync/get';
import {
  assertMoveFilesAvailable,
  recordMoveCompletion,
  reportMoveFailure,
} from './move_recovery';

export async function continueAction(
  opts: { addAll: boolean },
  context: TContext
): Promise<void> {
  if (!context.engine.rebaseInProgress()) {
    clearContinuation(context);
    throw new NoGraphiteContinue();
  }

  if (opts.addAll) {
    context.engine.addAll();
  }
  const rebasedBranchBase = context.continueConfig.data.rebasedBranchBase;
  const branchesToSync = context.continueConfig.data?.branchesToSync;
  const branchesToRestack = context.continueConfig.data?.branchesToRestack;

  if (!rebasedBranchBase) {
    clearContinuation(context);
    throw new NoGraphiteContinue('git rebase --continue');
  }

  const activeBranch = context.engine.getRebaseHead();
  let cont: ReturnType<TContext['engine']['continueRebase']>;
  try {
    if (
      activeBranch &&
      (context.continueConfig.data.move || context.continueConfig.data.fold)
    ) {
      assertMoveFilesAvailable(
        getBranchesToRestack(
          [activeBranch, ...(branchesToRestack ?? [])],
          context
        ),
        context
      );
    }
    cont = context.engine.continueRebase(rebasedBranchBase);
  } catch (error) {
    if (error instanceof RebaseCheckoutError) {
      recordMoveCompletion(error.branchName, context);
    }
    reportMoveFailure(
      error instanceof RebaseCheckoutError
        ? error.branchName
        : activeBranch ?? 'unknown branch',
      branchesToRestack ?? [],
      context
    );
    throw error;
  }
  if (cont.result === 'REBASE_CONFLICT') {
    persistContinuation(
      { branchesToRestack: branchesToRestack, rebasedBranchBase },
      context
    );
    printConflictStatus(`Rebase conflict is not yet resolved.`, context);
    reportMoveFailure(
      context.engine.getRebaseHead() ?? 'unknown branch',
      branchesToRestack ?? [],
      context
    );
    throw new RebaseConflictError();
  }

  recordMoveCompletion(cont.branchName, context);
  context.splog.info(
    `Resolved rebase conflict for ${chalk.green(cont.branchName)}.`
  );

  if (branchesToSync?.length) {
    await getBranchesFromRemote(
      {
        downstack: branchesToSync,
        base: context.engine.currentBranchPrecondition,
        force: false,
      },
      context
    );
  }

  if (branchesToRestack) {
    restackBranches(branchesToRestack, context);
  }
  clearContinuation(context);
}
