import { default as chalk } from 'chalk';
import { TContext } from '../../lib/context';
import { getDeleteSurvivors, isSafeToDelete } from '../delete_branch';
import { SCOPE } from '../../lib/engine/scope_spec';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertNoGitOperation } from '../../lib/git/assert_no_operation';
import { ExitFailedError } from '../../lib/errors';

/** Selection retains the existing DFS scope: only descend through candidates. */
export async function cleanBranches(
  opts: { showDeleteProgress: boolean; force: boolean; restack: boolean },
  context: TContext
): Promise<{ changed: string[]; mandatory: string[] }> {
  const queue = [...context.engine.getChildren(context.engine.trunk)];
  const progress = opts.showDeleteProgress ? getProgressMarkers(queue) : {};
  const selected: string[] = [];
  while (queue.length) {
    const branch = queue.pop();
    if (!branch) continue;
    if (branch in progress)
      context.splog.info(
        `${progress[branch]} done searching for merged/closed branches to delete...`
      );
    if (
      await shouldDeleteBranch(
        { branchName: branch, force: opts.force },
        context
      )
    ) {
      selected.push(branch);
      queue.push(...context.engine.getChildren(branch));
    }
  }

  // Plan before removing any candidate: filtering frozen replay tips here loses survivors.
  const allowed = selected.filter((branch) => {
    const plan = getDeleteSurvivors(branch, context, selected);
    const frozen = plan.mandatory.filter(context.engine.isBranchFrozen);
    if (frozen.length)
      context.splog.info(
        `Skipping cleanup of ${branch}: frozen mandatory survivors ${frozen.join(
          ', '
        )}. Unfreeze them before cleanup.`
      );
    return frozen.length === 0;
  });
  const result: { changed: string[]; mandatory: string[] } = {
    changed: [],
    mandatory: [],
  };
  for (const root of allowed.filter(
    (branch) => !allowed.includes(context.engine.getParentPrecondition(branch))
  )) {
    const group = context.engine
      .getRelativeStack(root, SCOPE.UPSTACK)
      .filter((branch) => allowed.includes(branch));
    const plan = getDeleteSurvivors(root, context, group);
    const changed = executeCleanupGroup(
      { group, plan, restack: opts.restack },
      context
    );
    result.changed.push(...changed);
    result.mandatory.push(...plan.replay);
  }
  return result;
}

function executeCleanupGroup(
  opts: {
    group: string[];
    plan: ReturnType<typeof getDeleteSurvivors>;
    restack: boolean;
  },
  context: TContext
): string[] {
  const check = (): void => {
    for (const survivor of opts.plan.mandatory)
      context.engine.assertBranchEditable(survivor);
  };
  check();
  if (opts.restack && opts.plan.replay.length)
    assertNoGitOperation('sync cleanup');
  assertBranchesAvailableInWorktrees([...opts.group, ...opts.plan.replay]);
  const changed: string[] = [];
  try {
    for (const branch of opts.plan.mandatory) {
      const parent = context.engine.getParentPrecondition(branch);
      let survivor = parent;
      while (opts.group.includes(survivor))
        survivor = context.engine.getParentPrecondition(survivor);
      if (parent === survivor) continue;
      check();
      context.engine.setParent(branch, survivor, opts.plan.mandatory);
      changed.push(branch);
      context.splog.info(
        `Set parent of ${chalk.cyan(branch)} to ${chalk.blueBright(survivor)}.`
      );
    }
    for (const branch of [...opts.group].reverse()) {
      check();
      context.engine.deleteBranch(branch, check, opts.plan.mandatory);
      context.splog.info(`Deleted branch ${chalk.red(branch)}`);
    }
  } catch (error) {
    if (error instanceof Error)
      throw new ExitFailedError(
        `${error.message}\nCompleted cleanup changes are retained; inspect parents and remaining branches before retrying sync.`
      );
    throw error;
  }
  return changed;
}

function getProgressMarkers(trunkChildren: string[]): Record<string, string> {
  const progressMarkers: Record<string, string> = {};
  trunkChildren
    // Ignore the first child - don't show 0% progress.
    .slice(1)
    .forEach(
      (child, i) =>
        (progressMarkers[child] = `${+(
          // Add 1 to the overall children length to account for the fact that
          // when we're on the last trunk child, we're not 100% done - we need
          // to go through its stack.
          ((i + 1 / (trunkChildren.length + 1)) * 100).toFixed(2)
        )}%`)
    );
  return progressMarkers;
}

async function shouldDeleteBranch(
  args: {
    branchName: string;
    force: boolean;
  },
  context: TContext
): Promise<boolean> {
  const shouldDelete = isSafeToDelete(args.branchName, context);
  if (!shouldDelete.result) {
    return false;
  }

  // Don't delete empty branches without an associated PR
  if (
    context.engine.isBranchEmpty(args.branchName) &&
    !context.engine.getPrInfo(args.branchName)?.number
  ) {
    return false;
  }

  if (args.force) {
    return true;
  }

  if (!context.interactive) {
    return false;
  }

  return (
    (
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: `${shouldDelete.reason}. Delete it?`,
        initial: true,
      })
    ).value === true
  );
}
