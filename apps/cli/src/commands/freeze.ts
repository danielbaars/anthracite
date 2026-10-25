import yargs from 'yargs';
import { setBranchFrozen } from '../actions/freeze';
import { graphiteMetadata } from '../lib/runner';

export const command = 'freeze [branch]';
export const description =
  'Freeze a tracked branch and its downstack before trunk. Defaults to the current branch. Local edits are blocked; rename/untrack and permitted delete remain administrative operations. Direct Git is outside this protection.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .positional('branch', { type: 'string' })
    .check((argv) => {
      for (const token of process.argv.slice(2)) {
        if (token === '--') break;
        if (/^--(?:no-)?branch(?:=|$)/.test(token))
          throw new Error('Use one positional branch name.');
      }
      if (argv._.length > 1 || argv.branch === '' || Array.isArray(argv.branch))
        throw new Error('freeze accepts one nonempty positional branch.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<{ readonly branch?: string }>
): Promise<void> =>
  graphiteMetadata(argv, async (context) =>
    setBranchFrozen(argv.branch, true, context)
  );
