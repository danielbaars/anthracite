import yargs from 'yargs';
import { logAction } from '../../actions/log';
import { logShortClassic } from '../../actions/log_short_classic';
import { graphite } from '../../lib/runner';

const args = {
  classic: {
    global: false,
    type: 'boolean',
    default: false,
    describe:
      'Use the old logging style. Other log display options are ignored in classic mode.',
  },
  reverse: {
    global: false,
    describe: `Print the log upside down. Handy when you have a lot of branches!`,
    type: 'boolean',
    alias: 'r',
    default: false,
  },
  stack: {
    global: false,
    describe: `Only show ancestors and descendants of the current branch.`,
    type: 'boolean',
    alias: 's',
    default: false,
  },
  steps: {
    global: false,
    describe: `Only show this many levels upstack and downstack. Implies --stack.`,
    type: 'number',
    alias: 'n',
    default: undefined,
  },
  'show-untracked': {
    global: false,
    describe: `Include untracked branched in interactive selection`,
    demandOption: false,
    type: 'boolean',
    positional: false,
    alias: 'u',
  },
} as const;

export const command = '*';
export const description =
  'Log all branches tracked by Anthracite, showing dependencies and info for each.';
export const builder = args;
export const canonical = 'log';

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) =>
    argv.classic
      ? logShortClassic(context)
      : logAction(
          {
            style: 'FULL',
            reverse: argv.reverse,
            branchName:
              argv.steps !== undefined || argv.stack
                ? context.engine.currentBranchPrecondition
                : context.engine.trunk,
            steps: argv.steps,
            showUntracked: argv['show-untracked'],
          },
          context
        )
  );
