import chalk from 'chalk';
import { TContext } from '../lib/context';
import {
  NoGraphiteContinue,
  RebaseCheckoutError,
  RebaseConflictError,
  RebaseMetadataError,
} from '../lib/errors';
import { clearContinuation, persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';
import { getBranchesToRestack, restackBranches } from './restack';
import { getBranchesFromRemote } from './sync/get';
import {
  assertReorderContinuationClean,
  assertReorderFilesAvailable,
  finishReorder,
  recordReorderCompletion,
  reportReorderFailure,
} from './reorder_recovery';
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

  const activeBranch = context.engine.getRebaseHead();
  if (activeBranch) context.engine.assertBranchEditable(activeBranch);

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

  let cont: ReturnType<TContext['engine']['continueRebase']>;
  try {
    assertReorderContinuationClean(context);
    assertReorderFilesAvailable(context);
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
    if (
      error instanceof RebaseCheckoutError ||
      error instanceof RebaseMetadataError
    ) {
      recordMoveCompletion(error.branchName, context);
      recordReorderCompletion(error.branchName, context);
    }
    reportMoveFailure(
      error instanceof RebaseCheckoutError ||
        error instanceof RebaseMetadataError
        ? error.branchName
        : activeBranch ?? 'unknown branch',
      branchesToRestack ?? [],
      context
    );
    reportReorderFailure(
      context,
      error instanceof RebaseMetadataError
        ? 'replay metadata publication'
        : undefined
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
    reportReorderFailure(context);
    throw new RebaseConflictError();
  }

  recordMoveCompletion(cont.branchName, context);
  recordReorderCompletion(cont.branchName, context);
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
  finishReorder(context);
  clearContinuation(context);
}
