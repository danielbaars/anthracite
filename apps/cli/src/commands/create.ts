import yargs from 'yargs';
import { createBranchAction } from '../actions/create_branch';
import { graphite } from '../lib/runner';

const args = {
  name: {
    type: 'string',
    positional: true,
    demandOption: false,
    optional: true,
    describe: 'The name of the new branch.',
    hidden: true,
  },
  onto: {
    alias: 'o',
    describe: 'Create above this tracked local branch or trunk.',
    type: 'string',
    requiresArg: true,
  },
  message: {
    describe: `Commit staged changes on the new branch with this message.`,
    demandOption: false,
    type: 'string',
    alias: 'm',
  },
  all: {
    describe: `Stage all unstaged changes on the new branch with this message.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'a',
  },
  patch: {
    describe: `Pick hunks to stage before committing.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'p',
  },
  'insert-child': {
    describe:
      'Insert beneath this exact direct child of the selected parent; repeat for multiple children. Requires --insert; omitted choices select all children.',
    type: 'string',
    array: true,
    nargs: 1,
    requiresArg: true,
  },
  insert: {
    describe: `Make chosen direct children of --onto (otherwise current branch) children of the new branch. Defaults to all children; use --insert-child to narrow the set. Refuses frozen parent-change or mandatory replay participants before creation.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'i',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const aliases = ['c'];
export const command = 'create [name]';
export const canonical = 'create';
export const description =
  'Create a new branch above --onto (or the current branch) and commit staged changes. If no branch name is specified but a commit message is passed, generate a branch name from the commit message.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli.options(args).check((argv) => {
    const children = argv['insert-child'];
    if (children !== undefined && !argv.insert)
      throw new Error('--insert-child requires an active --insert.');
    if (
      children?.some((child) => typeof child !== 'string' || child.length === 0)
    )
      throw new Error('--insert-child requires a nonempty branch name.');
    return true;
  });
export const handler = async (argv: argsT): Promise<void> => {
  return graphite(argv, canonical, async (context) => {
    await createBranchAction(
      {
        branchName: argv.name,
        onto: argv.onto,
        message: argv.message,
        all: argv.all,
        insert: argv.insert,
        insertChildren: argv['insert-child'],
        patch: argv.patch,
      },
      context
    );
  });
};
