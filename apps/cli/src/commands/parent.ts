import yargs from 'yargs';
import { graphiteInspection } from '../lib/runner';

export const command = 'parent';
export const description =
  'Print the direct tracking parent of the current branch.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli.showHelpOnFail(false).check((argv) => {
    if (argv._.length !== 1)
      throw new Error('parent does not accept a branch argument.');
    return true;
  });
export const handler = async (argv: yargs.Arguments): Promise<void> => {
  return graphiteInspection(argv, async (context) => {
    const parent = context.engine.getParentPrecondition(
      context.engine.currentBranchPrecondition
    );
    if (!argv.quiet) process.stdout.write(`${parent}\n`);
  });
};
