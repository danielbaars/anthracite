import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';
import { restackBranches } from './restack';
import { clearContinuation } from './persist_continuation';
import { interactiveBranchSelection } from './log';

/** Collapse one aligned linear chain into its chosen surviving name. */
export async function foldStack(
  keep: boolean,
  context: TContext
): Promise<void> {
  assertNoGitOperation('fold');
  const departure = context.engine.currentBranchPrecondition;
  uncommittedTrackedChangesPrecondition();
  // Include invalid tracked children too: validation must reject, not hide them.
  const childrenOf = (name: string): string[] =>
    context.engine.allBranchNames
      .filter((child) => context.engine.getParent(child) === name)
      .sort();
  const chain: string[] = [];
  let branch = departure;
  while (!context.engine.isTrunk(branch)) {
    if (chain.includes(branch))
      throw new PreconditionsFailedError('Invalid fold parent chain.');
    chain.unshift(branch);
    branch = context.engine.getParentPrecondition(branch);
  }
  if (chain.length === 0)
    throw new PreconditionsFailedError('Cannot fold trunk.');
  const tip = await selectFoldTip(departure, childrenOf, context);
  const upstack: string[] = [];
  branch = tip;
  while (branch !== departure) {
    upstack.unshift(branch);
    branch = context.engine.getParentPrecondition(branch);
  }
  chain.push(...upstack);
  for (const name of chain) {
    const parent = context.engine.getParentPrecondition(name);
    if (!context.engine.isBranchFixed(name)) {
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: needs restack. Run ch checkout '${name.replace(
          /'/g,
          "'\\''"
        )}' and ch restack before retrying fold --stack.`
      );
    }
    if (
      context.engine.getBaseRevision(name) !==
      context.engine.getRevision(parent)
    ) {
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: needs restack. Run ch restack before retrying.`
      );
    }
  }
  const survivor = keep ? tip : chain[0];
  const roots = chain.flatMap((name) =>
    childrenOf(name).filter((child) => !chain.includes(child))
  );
  const queue: string[] = [];
  const futureTips = new Map<string, string | undefined>([
    [survivor, context.engine.getRevision(tip)],
  ]);
  const changing: string[] = [];
  const visit = (name: string, parent: string): void => {
    if (queue.includes(name))
      throw new PreconditionsFailedError('Invalid fold subtree.');
    const from = context.engine.getBaseRevision(name);
    const revision = context.engine.getRevision(name);
    queue.push(name);
    const parentTip = futureTips.get(parent);
    const changesTip = parentTip === undefined || from !== parentTip;
    if (changesTip) changing.push(name);
    futureTips.set(
      name,
      changesTip ? (revision === from ? parentTip : undefined) : revision
    );
    for (const child of childrenOf(name)) visit(child, name);
  };
  roots.forEach((name) => visit(name, survivor));
  const reparented = roots.filter(
    (name) => context.engine.getParentPrecondition(name) !== survivor
  );
  const protectedBranches = [
    ...new Set([...chain, ...reparented, ...changing]),
  ];
  for (const name of protectedBranches) {
    if (context.engine.getPrInfo(name)?.number !== undefined)
      throw new PreconditionsFailedError(
        `Cannot fold ${name}: it has a locally known PR association. PR-aware stack fold is not supported.`
      );
  }
  if (chain.length === 1) return;
  assertBranchesAvailableInWorktrees(protectedBranches);
  assertRestackFilesAvailable({
    branches: changing.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [
      tip,
      departure,
      ...changing,
      ...changing.map((name) => context.engine.getParentPrecondition(name)),
    ].map((name) => `refs/heads/${name}`),
    skipTrackedPaths: true,
    operation: 'fold',
  });
  context.engine.foldStack(chain, survivor, roots);
  if (queue.length > 0) {
    context.continueConfig.update((data) => {
      data.fold = {
        survivor,
        removed: chain.filter((name) => name !== survivor),
        completed: [],
      };
    });
    restackBranches(queue, context);
    clearContinuation(context);
  }
  context.splog.info(`Folded stack into ${survivor}.`);
}

async function selectFoldTip(
  departure: string,
  childrenOf: (name: string) => string[],
  context: TContext
): Promise<string> {
  const tips: string[] = [];
  const visited = new Set<string>();
  const findTips = (name: string): void => {
    if (visited.has(name))
      throw new PreconditionsFailedError('Invalid fold subtree.');
    visited.add(name);
    context.engine.getBaseRevision(name);
    const children = childrenOf(name);
    if (children.length === 0) tips.push(name);
    else children.forEach(findTips);
  };
  findTips(departure);
  if (tips.length > 1 && !context.interactive)
    throw new PreconditionsFailedError(
      'Stack fold requires a unique tip in non-interactive mode.'
    );
  const tip =
    tips.length === 1
      ? tips[0]
      : await interactiveBranchSelection(
          {
            message: `Choose a tip above ${departure} to fold (autocomplete or arrow keys)`,
            allowedBranches: tips,
          },
          context
        );
  if (!tips.includes(tip))
    throw new PreconditionsFailedError('Invalid fold tip selection.');
  return tip;
}
