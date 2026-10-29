import { GetImportDecision } from './sync/get';
import { TContext } from '../lib/context';
import { recordRebaseOwnership } from '../lib/git/rebase_ownership';

export function persistContinuation(
  args: {
    branchesToRestack?: string[];
    branchesToSync?: string[];
    getImportDecisions?: GetImportDecision[];
    rebasedBranchBase: string;
  },
  context: TContext
): void {
  const [branchesToRestack, branchesToSync] = [
    args.branchesToRestack ?? [],
    args.branchesToSync ?? [],
  ];
  context.splog.debug(
    branchesToSync.reduce(
      (acc, curr) => `${acc}\n${curr}`,
      'PERSISTING (sync):'
    )
  );
  context.splog.debug(
    branchesToRestack.reduce(
      (acc, curr) => `${acc}\n${curr}`,
      'PERSISTING (restack):'
    )
  );
  const rebaseOwnership = recordRebaseOwnership();
  context.continueConfig.update((data) => {
    data.getImportDecisions =
      args.getImportDecisions ?? data.getImportDecisions;
    data.branchesToSync = branchesToSync;
    data.branchesToRestack = branchesToRestack;
    data.currentBranchOverride = context.engine.currentBranch;
    data.rebasedBranchBase = args.rebasedBranchBase;
    data.rebaseOwnership = rebaseOwnership;
  });
}

export function clearContinuation(context: TContext): void {
  const finishedOwnedOperation =
    context.continueConfig.data.split !== undefined ||
    context.continueConfig.data.absorb !== undefined;
  context.continueConfig.update((data) => {
    data.getImportDecisions = undefined;
    data.branchesToSync = [];
    data.branchesToRestack = [];
    data.currentBranchOverride = undefined;
    data.rebasedBranchBase = undefined;
    data.rebaseOwnership = undefined;
    data.delete = undefined;
    data.move = undefined;
    data.fold = undefined;
    data.insert = undefined;
    data.reorder = undefined;
    data.split = undefined;
    data.absorb = undefined;
  });
  if (finishedOwnedOperation) context.continueConfig.delete();
}
