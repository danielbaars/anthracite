import { TContext } from '../lib/context';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { getCurrentBranchName } from '../lib/git/branch_ops';

export function recordMoveCompletion(branch: string, context: TContext): void {
  if (
    !context.continueConfig.data.move &&
    !context.continueConfig.data.fold &&
    !context.continueConfig.data.insert
  )
    return;
  context.continueConfig.update((data) => {
    if (data.insert && !data.insert.completed.includes(branch))
      data.insert.completed.push(branch);
    if (data.fold && !data.fold.completed.includes(branch))
      data.fold.completed.push(branch);
    if (data.move && !data.move.completed.includes(branch)) {
      data.move.completed.push(branch);
    }
  });
}

export function reportMoveFailure(
  branch: string,
  remaining: readonly string[],
  context: TContext
): void {
  const move = context.continueConfig.data.move;
  const fold = context.continueConfig.data.fold;
  if (fold) {
    context.splog.warn(
      `Stack fold into ${
        fold.survivor
      } is incomplete at ${branch}. Selected collapse is complete; removed names: ${fold.removed.join(
        ', '
      )}. Parent changes and completed restacks remain.`
    );
    context.splog.info(
      `Completed branches: ${fold.completed.join(', ') || 'none'}.`
    );
    const pending = [branch, ...remaining].filter(
      (name) => !fold.completed.includes(name)
    );
    context.splog.info(
      `Current checkout: ${
        getCurrentBranchName() ?? 'detached HEAD'
      }. Remaining branches: ${pending.join(', ') || 'none'}.`
    );
    if (context.engine.rebaseInProgress())
      context.splog.info(
        'Resolve the conflict, git add the resolution and run an continue. an rebase --abort only cancels the active rebase; the selected collapse, removed names, parent changes and completed restacks remain.'
      );
    context.splog.info(
      'After abort, or after moving blocking local work aside and resolving the Git/hook error, retry each remaining branch in this order (resolve and an continue any new conflict before the next command):'
    );
    for (const name of pending)
      context.splog.info(`an restack --branch ${shellQuote(name)} --only`);
    context.splog.info(`an checkout ${shellQuote(fold.survivor)}`);
    return;
  }
  if (!move) return;
  const phase =
    branch === move.source
      ? 'source phase'
      : move.only
      ? 'left-behind child phase'
      : 'stack phase';
  context.splog.warn(
    `Move${move.only ? ' only' : ''} ${
      move.source
    } is incomplete in the ${phase} (${branch}). Parent changes and completed restacks remain.`
  );
  context.splog.info(
    `Completed branches: ${move.completed.join(', ') || 'none'}.`
  );
  const pending = [branch, ...remaining].filter(
    (name) => !move.completed.includes(name)
  );
  context.splog.info(`Remaining branches: ${pending.join(', ') || 'none'}.`);
  if (context.engine.rebaseInProgress()) {
    context.splog.info(
      'Resolve the conflict, git add the resolution and run an continue. an rebase --abort only cancels the active rebase; it keeps parent changes and completed restacks.'
    );
  }
  context.splog.info(
    'After abort, or after preserving the blocking local work, retry each remaining branch in this order (resolve and an continue any new conflict before the next command):'
  );
  for (const name of pending)
    context.splog.info(`an restack --branch ${shellQuote(name)} --only`);
  context.splog.info(`an checkout ${shellQuote(move.returnBranch)}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function assertMoveFilesAvailable(
  branches: readonly string[],
  context: TContext
): void {
  const move = context.continueConfig.data.move;
  const fold = context.continueConfig.data.fold;
  if (!move && !fold) return;
  assertRestackFilesAvailable({
    branches: branches.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [
      fold?.survivor ??
        move?.returnBranch ??
        context.engine.currentBranchPrecondition,
      ...branches.map((name) => context.engine.getParentPrecondition(name)),
    ].map((name) => `refs/heads/${name}`),
    skipTrackedPaths: true,
    operation: fold ? 'fold' : 'move',
  });
}
