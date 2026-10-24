import yargs from 'yargs';
import { reorderStack } from '../actions/edit/reorder_stack';
import { PreconditionsFailedError } from '../lib/errors';
import { editDownstack } from '../actions/edit/edit_downstack';
import { graphite } from '../lib/runner';

const args = {
  stack: {
    describe:
      'Reorder the complete trunk-to-tip feature chain in a top-first editor, returning to the original departure branch.',
    type: 'boolean',
    default: false,
    coerce: (value: boolean): boolean => {
      validateStackArguments(process.argv.slice(2));
      return value;
    },
  },
  input: {
    describe: `Path to file specifying stack edits. Using this argument skips prompting for stack edits and assumes the user has already formatted a list. Primarly used for unit tests.`,
    demandOption: false,
    hidden: true,
    type: 'string',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'reorder';
export const canonical = 'reorder';
export const description =
  'Reorder the branches between trunk and the current branch, restacking all of their descendants.';
export const builder = args;
export const aliases = ['ro'];

export const handler = async (argv: argsT): Promise<void> => {
  return graphite(argv, canonical, async (context) => {
    if (argv.stack) await reorderStack(argv.input, context);
    else await editDownstack(argv.input, context);
  });
};

function validateStackArguments(input: readonly string[]): void {
  let previous: string | undefined;
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (token === '--') {
      if (previous === 'true' && index + 1 < input.length)
        throw new PreconditionsFailedError(
          'Stack reorder does not accept positional arguments after --.'
        );
      break;
    }
    const match = /^(--(?:no-)?stack)(?:=(.*))?$/s.exec(token);
    if (!match) continue;
    let value = match[1] === '--no-stack' ? 'false' : 'true';
    if (match[2] !== undefined) value = match[2];
    else if (['true', 'false', ''].includes(input[index + 1]))
      value = input[++index];
    if (
      (value !== 'true' && value !== 'false') ||
      (previous !== undefined && previous !== value)
    )
      throw new PreconditionsFailedError(
        '--stack requires one nonempty, unambiguous boolean value (true or false).'
      );
    previous = value;
  }
}
