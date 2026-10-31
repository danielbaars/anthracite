import {
  assertLandingReplayParticipants,
  recordLandingReplayCompletion,
  restackLandingBranch,
} from './land_replay';
import chalk from 'chalk';
import { recordAbsorbCompletion } from './absorb_recovery';
import { TContext } from '../lib/context';
import {
  assertContinuationBranchesEditable,
  getStructuralRole,
} from '../lib/engine/frozen_branch';
import {
  RebaseCheckoutError,
  RebaseConflictError,
  RebaseMetadataError,
} from '../lib/errors';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { assertUnreachable } from '../lib/utils/assert_unreachable';
import { persistContinuation } from './persist_continuation';
import {
  assertDeleteRecoveryEditable,
  recordDeleteCompletion,
} from './delete_recovery';
import { printConflictStatus } from './print_conflict_status';
import {
  assertMoveFilesAvailable,
  recordMoveCompletion,
  reportMoveFailure,
} from './move_recovery';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';
import {
  assertReorderFilesAvailable,
  recordReorderCompletion,
  reportReorderFailure,
} from './reorder_recovery';
import {
  assertFileSplitAvailable,
  recordFileSplitCompletion,
} from './split_file_recovery';

/** Keep mandatory plans unfiltered; generic callers explicitly skip frozen anchors. */
export function getBranchesToRestack(
  branchNames: readonly string[],
  context: TContext,
  opts: {
    willChange?: readonly string[];
    parents?: ReadonlyMap<string, string>;
    skipFrozen?: boolean;
  } = {}
): string[] {
  const branchesToChange = new Set<string>();
  for (const branchName of branchNames) {
    if (context.engine.isTrunk(branchName)) continue;
    if (opts.skipFrozen && context.engine.isBranchFrozen(branchName)) continue;
    const parent =
      opts.parents?.get(branchName) ??
      context.engine.getParentPrecondition(branchName);
    const isFixed = opts.parents?.has(branchName)
      ? context.engine.getBaseRevision(branchName) ===
        context.engine.getRevision(parent)
      : context.engine.isBranchFixed(branchName);
    if (
      !isFixed ||
      opts.willChange?.includes(branchName) ||
      branchesToChange.has(parent)
    ) {
      branchesToChange.add(branchName);
    }
  }
  return [...branchesToChange];
}

type RestackOptions = {
  readonly preserveOtherRefs?: boolean;
  readonly beforeBranch?: (branchName: string) => void;
  readonly onComplete?: (branchName: string) => void;
};

export function restackBranches(
  branchNames: string[],
  context: TContext,
  options: RestackOptions = {}
): void {
  const skipFrozen = assertRestackAvailable(branchNames, context);
  context.splog.debug(
    branchNames.reduce((acc, curr) => `${acc}\n${curr}`, 'RESTACKING:')
  );
  while (branchNames.length > 0) {
    assertDeleteRecoveryEditable(context.continueConfig.data.delete);
    assertContinuationBranchesEditable(context.continueConfig.data);
    assertFileSplitAvailable(context.continueConfig.data);
    const branchName = branchNames.shift();
    if (!branchName) continue;
    options.beforeBranch?.(branchName);

    if (context.engine.isTrunk(branchName)) {
      context.splog.info(
        `${chalk.cyan(branchName)} does not need to be restacked.`
      );
      continue;
    }

    if (skipFrozen && context.engine.isBranchFrozen(branchName)) {
      context.splog.info(`Skipping frozen branch ${branchName}.`);
      continue;
    }

    try {
      if (context.continueConfig.data.reorder) {
        uncommittedTrackedChangesPrecondition();
        assertReorderFilesAvailable(context);
      }
      if (
        context.continueConfig.data.move ||
        context.continueConfig.data.fold
      ) {
        uncommittedTrackedChangesPrecondition();
        assertMoveFilesAvailable(
          getBranchesToRestack([branchName, ...branchNames], context),
          context
        );
      }
      const result = restackLandingBranch(branchName, context, options);
      context.splog.debug(`${result}: ${branchName}`);
      switch (result.result) {
        case 'REBASE_DONE':
          recordRestackCompletion(branchName, context);
          options.onComplete?.(branchName);
          context.splog.info(
            `Restacked ${chalk.green(branchName)} on ${chalk.cyan(
              context.engine.getParentPrecondition(branchName)
            )}.`
          );
          continue;

        case 'REBASE_CONFLICT':
          persistContinuation(
            {
              branchesToRestack: branchNames,
              rebasedBranchBase: result.rebasedBranchBase,
            },
            context
          );
          printConflictStatus(
            `Hit conflict restacking ${chalk.yellow(
              branchName
            )} on ${chalk.cyan(
              context.engine.getParentPrecondition(branchName)
            )}.`,
            context
          );
          throw new RebaseConflictError();

        case 'REBASE_UNNEEDED':
          recordRestackCompletion(branchName, context);
          options.onComplete?.(branchName);
          context.splog.info(
            `${chalk.cyan(
              branchName
            )} does not need to be restacked${` on ${chalk.cyan(
              context.engine.getParentPrecondition(branchName)
            )}`}.`
          );
          continue;

        default:
          assertUnreachable(result);
      }
    } catch (error) {
      if (
        error instanceof RebaseCheckoutError ||
        error instanceof RebaseMetadataError
      ) {
        recordRestackCompletion(error.branchName, context);
        options.onComplete?.(error.branchName);
      }
      assertDeleteRecoveryEditable(context.continueConfig.data.delete);
      reportMoveFailure(branchName, branchNames, context);
      reportReorderFailure(
        context,
        error instanceof RebaseMetadataError
          ? 'replay metadata publication'
          : undefined
      );
      throw error;
    }
  }
}

function assertRestackAvailable(
  branchNames: string[],
  context: TContext
): boolean {
  const data = context.continueConfig.data;
  const skipFrozen = !getStructuralRole(data);
  assertDeleteRecoveryEditable(data.delete);
  assertContinuationBranchesEditable(data);
  assertFileSplitAvailable(data);
  try {
    assertBranchesAvailableInWorktrees(
      getBranchesToRestack(branchNames, context, { skipFrozen })
    );
  } catch (error) {
    reportReorderFailure(context);
    throw error;
  }
  return skipFrozen;
}

export function recordRestackCompletion(
  branch: string,
  context: TContext
): void {
  recordLandingReplayCompletion(branch, context);
  assertLandingReplayParticipants();
  recordAbsorbCompletion(branch, context);
  recordFileSplitCompletion(branch, context);
  recordDeleteCompletion(branch, context);
  recordMoveCompletion(branch, context);
  recordReorderCompletion(branch, context);
}
