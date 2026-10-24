import yargs from 'yargs';
import { graphiteInspection } from '../lib/runner';

export const command = 'children';
export const description =
  'Print the direct tracked children of the current branch.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli.showHelpOnFail(false).check((argv) => {
    if (argv._.length !== 1)
      throw new Error('children does not accept a branch argument.');
    return true;
  });
export const handler = async (argv: yargs.Arguments): Promise<void> => {
  return graphiteInspection(argv, async (context) => {
    const children = context.engine.getChildrenPrecondition(
      context.engine.currentBranchPrecondition
    );
    children.sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    );
    if (!argv.quiet)
      for (const child of children) process.stdout.write(`${child}\n`);
  });
};
