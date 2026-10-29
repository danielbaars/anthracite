import yargs from 'yargs';
import { applyAbsorb } from '../actions/absorb_apply';

import { planAbsorb, printAbsorbPlan } from '../actions/absorb_plan';
import { PreconditionsFailedError } from '../lib/errors';
import { graphiteInspection } from '../lib/runner';

const options = {
  force: {
    type: 'boolean',
    default: false,
    describe: 'Apply without confirmation.',
  },
  'dry-run': {
    type: 'boolean',
    default: false,
    describe: 'Preview staged text correction destinations without effects.',
  },
} as const;

export const command = 'absorb';
export const description =
  'Absorb staged text corrections into an original commit and replay its linear descendants.';
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
    if (
      [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      ].some((name) => process.env[name] !== undefined)
    )
      throw new PreconditionsFailedError(
        'Absorb does not support Git environment redirection. Unset repository/index overrides before retrying.'
      );
    if (!argv['dry-run'] && !argv.force)
      throw new PreconditionsFailedError(
        'Absorb application requires --force. Use --dry-run to preview.'
      );
    const plan = planAbsorb(context);
    if (argv['dry-run']) {
      if (!argv.quiet) printAbsorbPlan(plan);
    } else applyAbsorb(plan, context, argv.verify === false);
  });
};
