import yargs from 'yargs';
import { continueAction } from '../actions/continue';
import { graphite } from '../lib/runner';

const args = {
  all: {
    describe: `Stage all changes before continuing.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'a',
  },
} as const;

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'continue';
export const canonical = 'continue';
export const aliases = ['cont'];
export const description =
  'Continues the most recent Anthracite command halted by a merge conflict. Landing continuation is local-only: no merge, push or PR edit; explicitly resume an land for remote work. A frozen active branch must be explicitly unfrozen before continuing or staging with --all.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(
    argv,
    canonical,
    async (context) => await continueAction({ addAll: argv.all }, context)
  );
