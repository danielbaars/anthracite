import chalk from 'chalk';
import { continueAbsorb } from './absorb_apply';
import { TContext } from '../lib/context';
import {
  assertContinuationBranchesEditable,
  getMandatoryBranches,
} from '../lib/engine/frozen_branch';
import {
  NoGraphiteContinue,
  RebaseCheckoutError,
  RebaseConflictError,
  RebaseMetadataError,
} from '../lib/errors';
import { clearContinuation, persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';
import {
  getBranchesToRestack,
  recordRestackCompletion,
  restackBranches,
} from './restack';
import { getBranchesFromRemote } from './sync/get';
import { assertDeleteRecoveryEditable } from './delete_recovery';
import {
  assertReorderContinuationClean,
  assertReorderFilesAvailable,
  finishReorder,
  reportReorderFailure,
} from './reorder_recovery';
import { assertMoveFilesAvailable, reportMoveFailure } from './move_recovery';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import {
  assertFileSplitAvailable,
  finishFileSplit,
  reportFileSplitFailure,
} from './split_file_recovery';

export async function continueAction(
  opts: { addAll: boolean },
  context: TContext
): Promise<void> {
  const data = context.continueConfig.data;
  if (data.absorb) {
    continueAbsorb(opts, context);
    return;
  }
  if (!context.engine.rebaseInProgress()) {
    clearContinuation(context);
    throw new NoGraphiteContinue();
  }

  const activeBranch = context.engine.getRebaseHead();
  assertContinuationBranchesEditable(data, activeBranch);
  if (activeBranch) context.engine.assertBranchEditable(activeBranch);

  assertDeleteRecoveryEditable(data.delete);
  assertFileSplitAvailable(data);
  if (data.insert)
    assertBranchesAvailableInWorktrees(getMandatoryBranches(data));
  if (opts.addAll) {
    context.engine.addAll();
  }
  const rebasedBranchBase = data.rebasedBranchBase;
  const branchesToSync = data.branchesToSync;
  const branchesToRestack = data.branchesToRestack;

  if (!rebasedBranchBase) {
    clearContinuation(context);
    throw new NoGraphiteContinue('git rebase --continue');
  }

  let cont: ReturnType<TContext['engine']['continueRebase']>;
  try {
    assertReorderContinuationClean(context);
    assertReorderFilesAvailable(context);
    if (activeBranch && (data.move || data.fold)) {
      assertMoveFilesAvailable(
        getBranchesToRestack(
          [activeBranch, ...(branchesToRestack ?? [])],
          context
        ),
        context
      );
    }
    cont = context.engine.continueRebase(
      rebasedBranchBase,
      getMandatoryBranches(data)
    );
  } catch (error) {
    if (
      error instanceof RebaseCheckoutError ||
      error instanceof RebaseMetadataError
    ) {
      recordRestackCompletion(error.branchName, context);
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
    reportFileSplitFailure(context);
    throw error;
  }
  if (cont.result === 'REBASE_CONFLICT') {
    persistContinuation(
      { branchesToRestack, branchesToSync, rebasedBranchBase },
      context
    );
    printConflictStatus(`Rebase conflict is not yet resolved.`, context);
    reportMoveFailure(
      context.engine.getRebaseHead() ?? 'unknown branch',
      branchesToRestack ?? [],
      context
    );
    reportReorderFailure(context);
    reportFileSplitFailure(context);
    throw new RebaseConflictError();
  }

  recordRestackCompletion(cont.branchName, context);
  context.splog.info(
    `Resolved rebase conflict for ${chalk.green(cont.branchName)}.`
  );

  if (branchesToSync?.length) {
    await getBranchesFromRemote(
      {
        downstack: branchesToSync,
        importDecisions: data.getImportDecisions,
        base: context.engine.currentBranchPrecondition,
        force: false,
      },
      context
    );
  }

  try {
    if (branchesToRestack) {
      restackBranches(branchesToRestack, context);
    }
    finishFileSplit(context);
  } catch (error) {
    reportFileSplitFailure(context);
    throw error;
  }
  finishReorder(context);
  clearContinuation(context);
}
