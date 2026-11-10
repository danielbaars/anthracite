import yargs from 'yargs';
import { land } from '../actions/land';
import { graphiteInspection } from '../lib/runner';

export const command = 'land [branch]';
export const canonical = 'land';
export const description =
  'Land the selected GitHub PR chain and maintain necessary surviving arms; preview first with --dry-run.';
const options = {
  'dry-run': {
    type: 'boolean',
    default: false,
    description:
      'Show PR order, deferred publication, maintenance and blockers without writes; add --debug for commit details.',
  },
  yes: {
    type: 'boolean',
    default: false,
    description:
      'Confirm the disclosed application scope in noninteractive mode.',
  },
  'wait-timeout': {
    type: 'number',
    default: 600,
    description:
      'Seconds to wait for running required checks before each merge; 0 stops immediately. Dry-runs never wait.',
  },
} as const;
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .options(options)
    .positional('branch', { type: 'string' })
    .check((argv) => {
      if (
        !Number.isSafeInteger(argv['wait-timeout']) ||
        argv['wait-timeout'] < 0 ||
        argv['wait-timeout'] > 86400
      )
        throw new Error(
          'land --wait-timeout requires an integer from 0 to 86400 seconds.'
        );
      for (const argument of process.argv.slice(2)) {
        if (argument === '--') break;
        if (/^--(?:no-)?branch(?:=|$)/.test(argument))
          throw new Error('land accepts a positional branch name only.');
        if (/^--no-wait-timeout(?:=|$)/.test(argument))
          throw new Error('Use --wait-timeout 0 to disable waiting.');
        if (/^--(?:no-)?(?:yes|dry-run)=(?!true$|false$)/.test(argument))
          throw new Error('land boolean options require true or false.');
      }
      if (argv._.length > 1)
        throw new Error('land accepts at most one positional branch.');
      if (argv.branch === '')
        throw new Error('land requires a nonempty branch name.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<
    yargs.InferredOptionTypes<typeof options> & { branch?: string }
  >
): Promise<void> => {
  await graphiteInspection(argv, async (context) =>
    land(argv.branch, argv, context)
  );
};
