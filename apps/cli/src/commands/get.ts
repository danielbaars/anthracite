import yargs from 'yargs';
import { getAction } from '../actions/sync/get';
import { graphite } from '../lib/runner';

const args = {
  branch: {
    describe: `Branch to get from remote`,
    demandOption: false,
    type: 'string',
    positional: true,
    hidden: true,
  },
  unfrozen: {
    describe:
      'Make new imports editable (default: only verified own PRs are editable)',
    type: 'boolean',
    default: false,
    alias: 'U',
  },
  force: {
    describe: 'Overwrite all fetched branches with remote source of truth',
    demandOption: false,
    type: 'boolean',
    default: false,
    alias: 'f',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'get [branch]';
export const canonical = 'get';
export const description =
  'Get branches from trunk to the specified branch from remote, prompting the user to resolve conflicts. If no branch is provided, get downstack from the current branch. New imports are frozen unless their PR author matches the current gh account, or --unfrozen is set. Existing branch status is preserved.';
export const builder = args;
export const aliases = ['g'];
export const handler = async (argv: argsT): Promise<void> =>
  graphite(
    argv,
    canonical,
    async (context) =>
      await getAction(
        { branchName: argv.branch, force: argv.force, unfrozen: argv.unfrozen },
        context
      )
  );
