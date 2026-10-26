import { TContext } from '../lib/context';
import { readMetadataRef } from '../lib/engine/metadata_ref';
import { PreconditionsFailedError } from '../lib/errors';
import { getCurrentBranchName } from '../lib/git/branch_ops';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { runGitCommand } from '../lib/git/runner';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';

/** Save the bounded plan before installing its parent-first selected graph. */
export function beginReorder(
  args: {
    returnBranch: string;
    order: readonly string[];
    parents: ReadonlyMap<string, string>;
    original: ReadonlyMap<string, { from: string }>;
    pending: readonly string[];
  },
  context: TContext
): void {
  context.continueConfig.update((data) => {
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
    data.reorder = {
      returnBranch: args.returnBranch,
      graphApplied: false,
      plan: [...args.parents].map(([name, parent]) => {
        const branch = args.original.get(name);
        if (!branch)
          throw new PreconditionsFailedError('Invalid reorder plan.');
        return { name, parent, from: branch.from };
      }),
      completed: [],
      pending: [...args.pending],
      checkout: args.returnBranch,
    };
  });
  try {
    for (const name of args.order) {
      const parent = args.parents.get(name);
      if (!parent) throw new PreconditionsFailedError('Invalid reorder plan.');
      context.engine.setParent(name, parent, [
        args.returnBranch,
        ...args.pending,
      ]);
    }
    context.continueConfig.update((data) => {
      if (data.reorder) data.reorder.graphApplied = true;
    });
  } catch (error) {
    reportReorderFailure(context);
    throw error;
  }
}

/** Original own bases stay frozen even after earlier branches finish replay. */
export function assertReorderFilesAvailable(context: TContext): void {
  const reorder = context.continueConfig.data.reorder;
  if (!reorder) return;
  const remaining = reorder.plan.filter(({ name }) =>
    reorder.pending.includes(name)
  );
  assertBranchesAvailableInWorktrees([
    ...reorder.pending,
    reorder.returnBranch,
  ]);
  assertRestackFilesAvailable({
    branches: remaining,
    checkoutRevisions: [
      reorder.returnBranch,
      ...remaining.map(({ parent }) => parent),
    ].map((name) => `refs/heads/${name}`),
    skipTrackedPaths: true,
    operation: 'reorder',
  });
}

/** Staged resolutions are expected; reject unstaged work before Git refreshes the index. */
export function assertReorderContinuationClean(context: TContext): void {
  if (!context.continueConfig.data.reorder) return;
  if (
    runGitCommand({
      args: [
        '--no-optional-locks',
        '-c',
        'diff.autoRefreshIndex=false',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        '-z',
      ],
      onError: 'throw',
      resource: 'reorderContinueChanges',
    })
  )
    throw new PreconditionsFailedError(
      'Cannot continue reorder with unstaged tracked changes. Stage the conflict resolution and preserve other unfinished work before retrying.'
    );
}

export function recordReorderCompletion(
  branch: string,
  context: TContext
): void {
  if (!context.continueConfig.data.reorder) return;
  context.continueConfig.update((data) => {
    if (!data.reorder) return;
    if (!data.reorder.completed.includes(branch))
      data.reorder.completed.push(branch);
    data.reorder.pending = data.reorder.pending.filter(
      (name) => name !== branch
    );
    data.reorder.checkout = getCurrentBranchName();
    data.reorder.conflictBranch = undefined;
  });
}

export function reportReorderFailure(
  context: TContext,
  phase?: 'replay metadata publication'
): void {
  const reorder = context.continueConfig.data.reorder;
  if (!reorder) return;
  const checkout = getCurrentBranchName();
  const conflictBranch = context.engine.rebaseInProgress()
    ? context.engine.getRebaseHead()
    : undefined;
  context.continueConfig.update((data) => {
    if (!data.reorder) return;
    data.reorder.checkout = checkout;
    data.reorder.conflictBranch = conflictBranch;
  });
  context.splog.warn(
    'Stack reorder is incomplete. Parent changes and completed restacks remain.'
  );
  context.splog.info(
    `Departure branch: ${reorder.returnBranch}. Parent graph: ${
      reorder.graphApplied ? 'applied' : 'incomplete'
    }.`
  );
  context.splog.info(
    `Conflict branch: ${conflictBranch ?? 'none'}. Current checkout: ${
      checkout ?? 'detached HEAD'
    }.`
  );
  context.splog.info(
    `Completed branches: ${reorder.completed.join(', ') || 'none'}.`
  );
  context.splog.info(
    `Remaining branches: ${reorder.pending.join(', ') || 'none'}.`
  );
  if (!reorder.graphApplied || phase) {
    context.splog.info(`Phase: ${phase ?? 'parent graph installation'}.`);
    // A rejected write may already have changed the engine's in-memory graph.
    for (const { name } of reorder.plan) {
      const metadata = readMetadataRef(name);
      const revision = runGitCommand({
        args: ['rev-parse', '--verify', `refs/heads/${name}`],
        onError: 'ignore',
        resource: 'reorderSavedRef',
      });
      context.splog.info(
        `Saved branch: ${name} -> ${
          metadata.parentBranchName ?? 'unknown'
        }; ref: ${revision || 'missing'}; base: ${
          metadata.parentBranchRevision ?? 'unknown'
        }.`
      );
    }
  }
  if (!reorder.graphApplied) {
    context.splog.info(
      'Parent graph was not completely applied. Inspect the saved parents before further changes.'
    );
    return;
  }
  context.splog.info(
    `Applied parents: ${reorder.plan
      .map(({ name, parent }) => `${name} -> ${parent}`)
      .join(', ')}.`
  );
  if (conflictBranch)
    context.splog.info(
      'Resolve the conflict, git add the resolution and run an continue. an rebase --abort only cancels the active rebase; parent changes and completed restacks remain.'
    );
  context.splog.info(
    'After abort, or after preserving blocking local work and resolving the Git error, retry each remaining branch in this order (resolve and an continue any new conflict before the next command):'
  );
  for (const name of reorder.pending)
    context.splog.info(`an restack --branch ${shellQuote(name)} --only`);
  context.splog.info(`an checkout ${shellQuote(reorder.returnBranch)}`);
}

export function finishReorder(context: TContext): void {
  const reorder = context.continueConfig.data.reorder;
  if (!reorder) return;
  try {
    uncommittedTrackedChangesPrecondition();
    assertReorderFilesAvailable(context);
    if (getCurrentBranchName() !== reorder.returnBranch)
      context.engine.checkoutBranch(reorder.returnBranch, {
        preserveIgnored: true,
      });
  } catch (error) {
    reportReorderFailure(context);
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
