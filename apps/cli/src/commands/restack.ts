import yargs from 'yargs';
import { restackBranches } from '../actions/restack';
import { SCOPE } from '../lib/engine/scope_spec';
import { graphite } from '../lib/runner';
import {
  isPendingSyncReconciliation,
  readSyncReconciliation,
} from '../lib/engine/sync_reconciliation';

const args = {
  branch: {
    describe: 'Which branch to run this command from (default: current branch)',
    type: 'string',
  },
  downstack: {
    describe: 'Only restack this branch and its ancestors.',
    type: 'boolean',
    default: false,
    alias: 'd',
  },
  upstack: {
    describe: 'Only restack this branch and its descendants.',
    type: 'boolean',
    default: false,
    alias: 'u',
  },
  only: {
    describe: 'Only restack this branch.',
    type: 'boolean',
    default: false,
    alias: 'o',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const aliases = ['r'];
export const command = 'restack';
export const canonical = 'restack';
export const description =
  'Ensure each branch in the current stack is based on its parent, rebasing if necessary. Skip frozen branches and use their unchanged tips as anchors. Use --upstack, --downstack, or --only to limit the scope.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    const scope = argv.only
      ? SCOPE.BRANCH
      : argv.upstack
      ? SCOPE.UPSTACK
      : argv.downstack
      ? SCOPE.DOWNSTACK
      : SCOPE.STACK;
    const { entries } = readSyncReconciliation();
    const branches = context.engine.getRelativeStack(
      argv.branch ?? context.engine.currentBranchPrecondition,
      scope
    );
    return restackBranches(
      branches.filter((branch) => {
        if (!isPendingSyncReconciliation(branch, entries)) return true;
        context.splog.info(
          `Skipping ${branch}: pending reconciliation. See an log.`
        );
        return false;
      }),
      context,
      { preserveOtherRefs: entries.length > 0 }
    );
  });
