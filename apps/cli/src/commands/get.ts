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
  downstack: {
    describe:
      'Limit remote refresh to the required PR chain; affected siblings may still need maintenance',
    type: 'boolean',
    default: false,
  },
  restack: {
    describe:
      'Restack affected local work after incoming updates; --no-restack defers maintenance',
    type: 'boolean',
    default: true,
  },
  checkout: {
    describe:
      'Select the target after all phases; --no-checkout restores the original branch or detached OID',
    type: 'boolean',
    default: true,
  },
  force: {
    describe:
      'Overwrite eligible selected feature heads; preserve frozen status and file/worktree guards',
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
  'Refresh the target PR chain and eligible tracked local descendants; --downstack excludes descendant refresh. Restack affected local work by default, including necessary siblings outside refresh scope. Trunk advances by fast-forward only, even with --force. Final checkout runs after all phases. An omitted target uses the physical current branch; detached HEAD needs an explicit target. New imports retain ownership-based freeze defaults. Get performs no cleanup or publication.';
export const builder = args;
export const aliases = ['g'];
export const handler = async (argv: argsT): Promise<void> =>
  graphite(
    argv,
    canonical,
    async (context) =>
      await getAction(
        {
          branchName: argv.branch,
          force: argv.force,
          unfrozen: argv.unfrozen,
          downstack: argv.downstack,
          checkout: argv.checkout,
          restack: argv.restack,
        },
        context
      )
  );
