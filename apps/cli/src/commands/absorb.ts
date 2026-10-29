import yargs from 'yargs';

import { planAbsorb, printAbsorbPlan } from '../actions/absorb_plan';
import { PreconditionsFailedError } from '../lib/errors';
import { graphiteInspection } from '../lib/runner';

const options = {
  'dry-run': {
    type: 'boolean',
    default: false,
    describe: 'Preview staged text correction destinations without effects.',
  },
} as const;

export const command = 'absorb';
export const description =
  'Preview which original commits can receive staged text corrections.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .showHelpOnFail(false)
    .options(options)
    .check((argv) => {
      if (argv._.length !== 1)
        throw new Error('absorb does not accept positional arguments.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<yargs.InferredOptionTypes<typeof options>>
): Promise<void> => {
  return graphiteInspection(argv, async (context) => {
    if (!argv['dry-run'])
      throw new PreconditionsFailedError(
        'Absorb application is not available yet. Use --dry-run to preview.'
      );
    const plan = planAbsorb(context);
    if (!argv.quiet) printAbsorbPlan(plan);
  });
};
