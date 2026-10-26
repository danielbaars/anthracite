import yargs from 'yargs';
import { untrackBranch } from '../actions/untrack_branch';
import { graphite } from '../lib/runner';

const args = {
  branch: {
    describe: `Branch to stop tracking.`,
    demandOption: false,
    positional: true,
    type: 'string',
    hidden: true,
  },
  force: {
    describe:
      'Will not prompt for confirmation before untracking a branch with children.',
    alias: 'f',
    default: false,
    type: 'boolean',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'untrack [branch]';
export const canonical = 'untrack';
export const aliases = ['utr', 'ut'];
export const description =
  'Stop tracking a branch with Anthracite, including a frozen branch. Its own stored status is removed; descendants become untracked while retaining their stored metadata and status. Defaults to the current branch.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) =>
    untrackBranch(
      {
        branchName: argv.branch ?? context.engine.currentBranchPrecondition,
        force: argv.force,
      },
      context
    )
  );
