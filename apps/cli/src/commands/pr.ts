import yargs from 'yargs';
import { selectPrBranch } from '../actions/pr_selection';
import { inspectPr } from '../actions/inspect_pr';
import { graphiteInspection } from '../lib/runner';

export const command = 'pr [branch]';
export const canonical = 'pr';
export const description =
  'Inspect the current or selected tracked branch pull request on GitHub.';
const options = {
  stack: {
    type: 'boolean',
    default: false,
    describe:
      'Show the connected stack, including fanout beneath the same trunk child.',
  },
  web: {
    type: 'boolean',
    default: false,
    describe: 'Open only the selected pull request on GitHub.',
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
          throw new Error('pr accepts a positional branch name only.');
        if (/^--(?:no-)?(?:stack|web)=(?!true$|false$)/.test(argument))
          throw new Error('pr boolean options require true or false.');
      }
      if (argv._.length > 1)
        throw new Error('pr accepts at most one positional branch.');
      if (argv.branch === '')
        throw new Error('pr requires a nonempty branch name.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<
    yargs.InferredOptionTypes<typeof options> & { branch?: string }
  >
): Promise<void> => {
  await graphiteInspection(argv, async (context) => {
    const branch = selectPrBranch(argv.branch, context);
    await inspectPr(branch, argv, context);
  });
};
