import chalk from 'chalk';
import { TContext } from '../lib/context';
import { RebaseConflictError } from '../lib/errors';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { assertUnreachable } from '../lib/utils/assert_unreachable';
import { persistContinuation } from './persist_continuation';
import { printConflictStatus } from './print_conflict_status';

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
  assertBranchesAvailableInWorktrees(
    getBranchesToRestack(branchNames, context)
  );

  context.splog.debug(
    branchNames.reduce((acc, curr) => `${acc}\n${curr}`, 'RESTACKING:')
  );
  while (branchNames.length > 0) {
    const branchName = branchNames.shift() as string;

    if (context.engine.isTrunk(branchName)) {
      context.splog.info(
        `${chalk.cyan(branchName)} does not need to be restacked.`
      );
      continue;
    }

    const result = context.engine.restackBranch(branchName);
    context.splog.debug(`${result}: ${branchName}`);
    switch (result.result) {
      case 'REBASE_DONE':
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
          `Hit conflict restacking ${chalk.yellow(branchName)} on ${chalk.cyan(
            context.engine.getParentPrecondition(branchName)
          )}.`,
          context
        );
        throw new RebaseConflictError();

      case 'REBASE_UNNEEDED':
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
  }
}
