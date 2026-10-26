import yargs from 'yargs';
import { foldCurrentBranch } from '../actions/fold_branch';
import { foldStack } from '../actions/fold_stack';
import { PreconditionsFailedError } from '../lib/errors';
import { graphite } from '../lib/runner';

const args = {
  stack: {
    describe:
      'Fold the complete trunk-to-tip feature chain into its original bottom branch, or its chosen tip with --keep (not a squash).',
    type: 'boolean',
    default: false,
    coerce: (value: boolean): boolean => {
      validateFoldArguments(process.argv.slice(2));
      return value;
    },
  },
  keep: {
    describe: `Keep the current name for ordinary fold; with --stack, keep the chosen tip name instead of the original bottom name.`,
    demandOption: false,
    type: 'boolean',
    alias: 'k',
    default: false,
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'fold';
export const canonical = 'fold';
export const description =
  "Fold a branch's changes into its parent, update dependencies of descendants of the new combined branch, and restack. Frozen contributors, survivors and mandatory participants are refused.";
export const builder = args;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) =>
    argv.stack
      ? foldStack(argv.keep, context)
      : foldCurrentBranch(argv.keep, context)
  );

function validateFoldArguments(input: readonly string[]): void {
  input = input.flatMap((token) => {
    // Preserve each short boolean declaration before yargs keeps only its last value.
    const group = /^-([qk]+)(.*)$/s.exec(token);
    if (!group) return [token];
    const options = group[1].split('').map((name) => `-${name}`);
    const suffix = group[2];
    options[options.length - 1] +=
      suffix && !suffix.startsWith('=') ? `=${suffix}` : suffix;
    return options;
  });
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (token === '--') {
      if (values.get('stack') === 'true' && index + 1 < input.length) {
        throw new PreconditionsFailedError(
          'Stack fold does not accept positional arguments after --.'
        );
      }
      break;
    }
    const match = /^(--(?:no-)?(stack|keep)|-k)(?:=(.*))?$/s.exec(token);
    if (!match) continue;
    const name = match[2] ?? 'keep';
    let value = match[1].startsWith('--no-') ? 'false' : 'true';
    if (match[3] !== undefined) value = match[3];
    else if (['true', 'false', ''].includes(input[index + 1]))
      value = input[++index];
    const previous = values.get(name);
    if (
      (value !== 'true' && value !== 'false') ||
      (previous !== undefined && value !== previous)
    ) {
      // Ordinary fold retains its historical keep parser behavior.
      if (name === 'keep') values.set('invalidKeep', 'true');
      else
        throw new PreconditionsFailedError(
          '--stack requires one nonempty, unambiguous boolean value (true or false).'
        );
    }
    values.set(name, value);
  }
  if (values.get('stack') === 'true' && values.has('invalidKeep')) {
    throw new PreconditionsFailedError(
      '--keep requires one nonempty, unambiguous boolean value (true or false) in stack mode.'
    );
  }
}
