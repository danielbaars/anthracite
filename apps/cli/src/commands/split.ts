import yargs from 'yargs';
import { splitCurrentBranch } from '../actions/split';
import { graphite } from '../lib/runner';
import { PreconditionsFailedError } from '../lib/errors';

const args = {
  ['by-file']: {
    describe:
      'Extract selected committed paths into a new parent without prompting.',
    type: 'string',
    array: true,
    requiresArg: true,
    alias: ['file', 'f'],
  },
  ['by-commit']: {
    describe: `Split by commit - slice up the history of this branch.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: ['c', 'commit'],
  },
  ['by-hunk']: {
    describe: `Split by hunk - split into new single-commit branches.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: ['h', 'hunk'],
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'split';
export const canonical = 'split';
export const aliases = ['sp'];
export const description =
  'Split the current branch into multiple single-commit branches. Frozen sources require an unfreeze first.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    if (argv['by-file'] !== undefined)
      throw new PreconditionsFailedError(
        'File split extraction is not available yet.'
      );
    return splitCurrentBranch(
      {
        style: argv['by-hunk']
          ? 'hunk'
          : argv['by-commit']
          ? 'commit'
          : undefined,
      },
      context
    );
  });
