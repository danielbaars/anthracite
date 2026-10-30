import yargs from 'yargs';
import { land } from '../actions/land';
import { graphiteInspection } from '../lib/runner';

export const command = 'land [branch]';
export const canonical = 'land';
export const description =
  'Land a ready GitHub leaf with guarded cleanup; preview broader stack scope.';
const options = {
  'dry-run': {
    type: 'boolean',
    default: false,
    description: 'Explain merge, maintenance and blockers without writes.',
  },
  yes: {
    type: 'boolean',
    default: false,
    description:
      'Confirm the disclosed application scope in noninteractive mode.',
  },
} as const;
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .options(options)
    .positional('branch', { type: 'string' })
    .check((argv) => {
      for (const argument of process.argv.slice(2)) {
        if (argument === '--') break;
        if (/^--(?:no-)?branch(?:=|$)/.test(argument))
          throw new Error('land accepts a positional branch name only.');
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
