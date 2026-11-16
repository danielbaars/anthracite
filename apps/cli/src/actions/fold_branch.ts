import chalk from 'chalk';
import { getSha } from '../lib/git/get_sha';
import { PreconditionsFailedError } from '../lib/errors';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { getBranchesToRestack, restackBranches } from './restack';
import { clearContinuation } from './persist_continuation';
import { getCurrentBranchName } from '../lib/git/branch_ops';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';

export function foldCurrentBranch(keep: boolean, context: TContext): void {
  assertNoGitOperation('fold');
  const currentBranchName = context.engine.currentBranchPrecondition;
  const parentBranchName =
    context.engine.getParentPrecondition(currentBranchName);
  if (context.engine.isTrunk(parentBranchName)) {
    throw new PreconditionsFailedError(
      `Cannot fold '${currentBranchName}' into trunk '${parentBranchName}'. Ordinary fold requires a non-trunk parent.`
    );
  }
  const survivor = keep ? currentBranchName : parentBranchName;
  const removed = keep ? parentBranchName : currentBranchName;
  const branches = context.engine
    .getRelativeStack(parentBranchName, SCOPE.UPSTACK)
    .filter((name) => name !== currentBranchName && name !== parentBranchName);
  const reparented = [...context.engine.getChildren(removed)].filter(
    (name) => name !== currentBranchName
  );
  const parents = new Map(reparented.map((name) => [name, survivor]));
  const changing = getBranchesToRestack(branches, context, {
    parents,
    willChange: keep
      ? []
      : branches.filter(
          (name) =>
            (parents.get(name) ?? context.engine.getParent(name)) ===
              survivor &&
            context.engine.getBaseRevision(name) !==
              context.engine.getRevision(currentBranchName)
        ),
  });
  const participants = [
    ...new Set([
      currentBranchName,
      parentBranchName,
      ...reparented,
      ...changing,
    ]),
  ];
  for (const name of participants) context.engine.assertBranchEditable(name);
  const before = readFoldState(participants);
  try {
    context.engine.foldCurrentBranch(keep, participants);
  } catch (error) {
    const after = readFoldState(participants);
    if (before === undefined || after === undefined) {
      context.splog.warn(
        'Fold stopped; remaining writes could not be verified. Inspect an info, the index and local files before retrying.'
      );
    } else if (before !== after) {
      context.splog.warn(
        `Fold stopped at checkout ${
          getCurrentBranchName() ?? 'detached HEAD'
        }; completed ref and parent writes remain. Inspect an info, the index and local files before retrying.`
      );
    }
    throw error;
  }
  context.continueConfig.update((data) => {
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
    data.fold = {
      survivor,
      removed: [removed],
      mandatory: [...new Set([...reparented, ...changing])],
      completed: [],
    };
  });
  if (keep) {
    context.splog.info(
      `Folded ${chalk.green(currentBranchName)} into ${chalk.blueBright(
        parentBranchName
      )}.`
    );
  } else {
    context.splog.info(
      `Folded ${chalk.blueBright(currentBranchName)} into ${chalk.green(
        parentBranchName
      )}.`
    );
    context.splog.tip(
      `To keep the name of the current branch, use the \`--keep\` flag.`
    );
  }
  restackBranches(
    context.engine.getRelativeStack(
      context.engine.currentBranchPrecondition,
      SCOPE.UPSTACK_EXCLUSIVE
    ),
    context
  );
  clearContinuation(context);
}

function readFoldState(participants: readonly string[]): string | undefined {
  try {
    return JSON.stringify([
      getCurrentBranchName(),
      getSha('HEAD'),
      ...participants.map((name) => [
        getSha(`refs/heads/${name}`),
        getSha(`refs/branch-metadata/${name}`),
      ]),
    ]);
  } catch {
    // An inspection failure must not replace the original fold error.
    return undefined;
  }
}
