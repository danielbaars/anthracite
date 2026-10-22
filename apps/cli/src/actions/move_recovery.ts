import { TContext } from '../lib/context';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';

export function recordMoveCompletion(branch: string, context: TContext): void {
  if (!context.continueConfig.data.move) return;
  context.continueConfig.update((data) => {
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
      'Resolve the conflict, git add the resolution and run ch continue. ch rebase --abort only cancels the active rebase; it keeps parent changes and completed restacks.'
    );
  }
  context.splog.info(
    'After abort, or after preserving the blocking local work, retry each remaining branch in this order (resolve and ch continue any new conflict before the next command):'
  );
  for (const name of pending)
    context.splog.info(`ch restack --branch ${shellQuote(name)} --only`);
  context.splog.info(`ch checkout ${shellQuote(move.returnBranch)}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function assertMoveFilesAvailable(
  branches: readonly string[],
  context: TContext
): void {
  const move = context.continueConfig.data.move;
  if (!move) return;
  assertRestackFilesAvailable({
    branches: branches.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [
      move.returnBranch,
      ...branches.map((name) => context.engine.getParentPrecondition(name)),
    ].map((name) => `refs/heads/${name}`),
    skipTrackedPaths: true,
    operation: 'move',
  });
}
