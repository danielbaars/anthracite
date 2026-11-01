import { TContext } from '../../lib/context';
import { clearContinuation } from '../persist_continuation';
import { SCOPE } from '../../lib/engine/scope_spec';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { restackBranches } from '../restack';
import { cleanBranches } from './clean_branches';
import { refreshSyncFeatures } from './sync_refresh';

export async function syncAction(
  opts: {
    pull: boolean;
    force: boolean;
    delete: boolean;
    deleteAll: boolean;
    showDeleteProgress: boolean;
    restack: boolean;
  },
  context: TContext
): Promise<void> {
  uncommittedTrackedChangesPrecondition();
  await refreshSyncFeatures(opts, context);

  if (opts.pull) {
    context.splog.tip('You can skip pulling trunk with the `--no-pull` flag.');
  }

  const branchesToRestack: string[] = [];
  let mandatory: string[] = [];

  if (opts.delete) {
    context.splog.info(
      `🧹 Checking if any branches have been merged/closed and can be deleted...`
    );
    const branchesWithNewParents = await cleanBranches(
      {
        showDeleteProgress: opts.showDeleteProgress,
        force: opts.force || opts.deleteAll,
        restack: opts.restack,
      },
      context
    );
    context.splog.tip(
      [
        'You can skip deleting branches with the `--no-delete` flag.',
        ...(opts.force || opts.deleteAll
          ? []
          : [
              'Try the `--delete-all` flag to delete eligible merged/closed branches without prompting for each.',
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
