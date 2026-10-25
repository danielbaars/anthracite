import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';

export function setBranchFrozen(
  branch: string | undefined,
  frozen: boolean,
  context: TContext
): void {
  const target = branch ?? context.engine.currentBranchPrecondition;
  // Validate the non-trunk target before traversing any editable participants.
  context.engine.getParentPrecondition(target);
  const descendants = (parent: string): string[] =>
    context.engine
      .getChildrenPrecondition(parent)
      .flatMap((child) => [child, ...descendants(child)]);
  const branches = frozen
    ? context.engine.getRelativeStack(target, SCOPE.DOWNSTACK)
    : [target, ...descendants(target)];
  context.engine.setBranchesFrozen(branches, frozen);
}
