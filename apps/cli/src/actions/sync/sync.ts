import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { clearContinuation } from '../persist_continuation';
import { SCOPE } from '../../lib/engine/scope_spec';
import { KilledError } from '../../lib/errors';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { restackBranches } from '../restack';
import { cleanBranches } from './clean_branches';
import { syncPrInfo } from '../sync_pr_info';

export async function syncAction(
  opts: {
    pull: boolean;
    force: boolean;
    delete: boolean;
    showDeleteProgress: boolean;
    restack: boolean;
  },
  context: TContext
): Promise<void> {
  uncommittedTrackedChangesPrecondition();
  context.splog.info(
    'Sync updates trunk and PR info; use ch get to refresh feature heads from remote.'
  );

  if (opts.pull) {
    await pullTrunk(opts.force, context);
    context.splog.tip('You can skip pulling trunk with the `--no-pull` flag.');
  }

  const branchesToRestack: string[] = [];
  let mandatory: string[] = [];

  await syncPrInfo(context.engine.allBranchNames, context);

  if (opts.delete) {
    context.splog.info(
      `🧹 Checking if any branches have been merged/closed and can be deleted...`
    );
    const branchesWithNewParents = await cleanBranches(
      {
        showDeleteProgress: opts.showDeleteProgress,
        force: opts.force,
        restack: opts.restack,
      },
      context
    );
    context.splog.tip(
      [
        'You can skip deleting branches with the `--no-delete` flag.',
        ...(opts.force
          ? []
          : [
              'Try the `--force` flag to delete merged branches without prompting for each.',
            ]),
        ...(opts.restack
          ? []
          : [
              'Try the `--restack` flag to automatically restack the current stack as well as any stacks with deleted branches.',
            ]),
      ].join('\n')
    );
    if (!opts.restack) {
      return;
    }

    mandatory = branchesWithNewParents.mandatory;
    branchesWithNewParents.changed
      .flatMap((branchName) =>
        context.engine.getRelativeStack(branchName, SCOPE.UPSTACK)
      )
      .forEach((branchName) => branchesToRestack.push(branchName));
  }
  if (!opts.restack) {
    context.splog.tip(
      'Try the `--restack` flag to automatically restack the current stack.'
    );
    return;
  }

  const currentBranch = context.engine.currentBranch;

  // The below conditional doesn't handle the trunk case because
  // isBranchTracked returns false for trunk.  Also, in this case
  // we don't want to append to our existing branchesToRestack
  // because trunk's stack will include everything anyway.
  if (currentBranch && context.engine.isTrunk(currentBranch)) {
    branchesToRestack.splice(
      0,
      branchesToRestack.length,
      ...context.engine.getRelativeStack(currentBranch, SCOPE.STACK)
    );
  }

  if (
    currentBranch &&
    context.engine.isBranchTracked(currentBranch) &&
    !branchesToRestack.includes(currentBranch)
  ) {
    context.engine
      .getRelativeStack(currentBranch, SCOPE.STACK)
      .forEach((branchName) => branchesToRestack.push(branchName));
  }

  if (mandatory.length) {
    context.continueConfig.update((data) => {
      data.delete = { branch: 'Cleanup candidates', mandatory };
      data.branchesToRestack = [...branchesToRestack];
      data.branchesToSync = [];
    });
  }
  restackBranches(branchesToRestack, context);
  if (mandatory.length) clearContinuation(context);
}

export async function pullTrunk(
  force: boolean,
  context: TContext
): Promise<void> {
  context.splog.info(
    `🌲 Pulling ${chalk.cyan(context.engine.trunk)} from remote...`
  );
  const pullResult = context.engine.pullTrunk();
  if (pullResult !== 'PULL_CONFLICT') {
    context.splog.info(
      pullResult === 'PULL_UNNEEDED'
        ? `${chalk.green(context.engine.trunk)} is up to date.`
        : `${chalk.green(context.engine.trunk)} fast-forwarded to ${chalk.gray(
            context.engine.getRevision(context.engine.trunk)
          )}.`
    );
    return;
  }

  // If trunk cannot be fast-forwarded, prompt the user to reset to remote
  context.splog.warn(
    `${chalk.blueBright(context.engine.trunk)} could not be fast-forwarded.`
  );
  if (
    force ||
    (context.interactive &&
      (
        await context.prompts({
          type: 'confirm',
          name: 'value',
          message: `Overwrite ${chalk.yellow(
            context.engine.trunk
          )} with the version from remote?`,
          initial: true,
        })
      ).value)
  ) {
    context.engine.resetTrunkToRemote();
    context.splog.info(
      `${chalk.green(context.engine.trunk)} set to ${chalk.gray(
        context.engine.getRevision(context.engine.trunk)
      )}.`
    );
  } else {
    throw new KilledError();
  }
}
