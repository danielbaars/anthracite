import { TContext } from '../lib/context';
import { DetachedError, PreconditionsFailedError } from '../lib/errors';
import { composeGit } from '../lib/git/git';

/** Selection uses physical HEAD even when saved replay state supplies an override. */
export function selectPrBranch(
  branch: string | undefined,
  context: TContext
): string {
  const selected = branch ?? composeGit().getCurrentBranchName();
  if (!selected) throw new DetachedError();
  if (context.engine.isTrunk(selected))
    throw new PreconditionsFailedError(
      'PR workflows require a tracked branch other than trunk.'
    );
  context.engine.getParentPrecondition(selected);
  return selected;
}

export function connectedPrBranches(
  branch: string,
  context: TContext
): string[] {
  let root = branch;
  while (context.engine.getParentPrecondition(root) !== context.engine.trunk)
    root = context.engine.getParentPrecondition(root);
  const result: string[] = [];
  const visit = (name: string): void => {
    context.engine.getParentPrecondition(name);
    result.push(name);
    for (const child of context.engine.getChildrenPrecondition(name))
      visit(child);
  };
  visit(root);
  return result;
}
