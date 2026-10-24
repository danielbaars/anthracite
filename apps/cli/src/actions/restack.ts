import chalk from 'chalk';
import { TContext } from '../lib/context';
import {
  RebaseCheckoutError,
  RebaseConflictError,
  RebaseMetadataError,
} from '../lib/errors';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { assertUnreachable } from '../lib/utils/assert_unreachable';
import { persistContinuation } from './persist_continuation';
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

/** Plan parent-first restacks, optionally including branches a pending commit will change. */
export function getBranchesToRestack(
  branchNames: readonly string[],
  context: TContext,
  opts: {
    willChange?: readonly string[];
    parents?: ReadonlyMap<string, string>;
  } = {}
): string[] {
  const branchesToChange = new Set<string>();
  for (const branchName of branchNames) {
    if (context.engine.isTrunk(branchName)) continue;
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

export function restackBranches(
  branchNames: string[],
  context: TContext
): void {
  try {
    assertBranchesAvailableInWorktrees(
      getBranchesToRestack(branchNames, context)
    );
  } catch (error) {
    reportReorderFailure(context);
    throw error;
  }

  context.splog.debug(
    branchNames.reduce((acc, curr) => `${acc}\n${curr}`, 'RESTACKING:')
  );
  while (branchNames.length > 0) {
    const branchName = branchNames.shift();
    if (!branchName) continue;

    if (context.engine.isTrunk(branchName)) {
      context.splog.info(
        `${chalk.cyan(branchName)} does not need to be restacked.`
      );
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
      const result = context.engine.restackBranch(branchName);
      context.splog.debug(`${result}: ${branchName}`);
      switch (result.result) {
        case 'REBASE_DONE':
          recordMoveCompletion(branchName, context);
          recordReorderCompletion(branchName, context);
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
          recordMoveCompletion(branchName, context);
          recordReorderCompletion(branchName, context);
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
        recordMoveCompletion(error.branchName, context);
        recordReorderCompletion(error.branchName, context);
      }
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
