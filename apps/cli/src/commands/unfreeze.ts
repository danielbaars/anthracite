import yargs from 'yargs';
import { setBranchFrozen } from '../actions/freeze';
import { graphiteMetadata } from '../lib/runner';

export const command = 'unfreeze [branch]';
export const description =
  'Unfreeze a tracked branch and all its upstack descendants. Defaults to the current branch. Trunk cannot be a target.';
export { builder } from './freeze';
export const handler = async (
  argv: yargs.Arguments<{ readonly branch?: string }>
): Promise<void> =>
  graphiteMetadata(argv, async (context) =>
    setBranchFrozen(argv.branch, false, context)
  );
