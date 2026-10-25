import yargs from 'yargs';
import { commitAmendAction } from '../actions/commit_amend';
import { commitCreateAction } from '../actions/commit_create';
import { editBranchAction } from '../actions/edit_branch';
import { graphite } from '../lib/runner';
import { PreconditionsFailedError } from '../lib/errors';
import { SCOPE } from '../lib/engine/scope_spec';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';

const args = {
  'interactive-rebase': {
    type: 'boolean',
    default: false,
    describe:
      'Interactively rebase the current branch and restack descendants. Ignores other modify operation options; global interaction and hook rules still apply.',
  },
  all: {
    describe: `Stage all changes before committing.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'a',
  },
  commit: {
    describe: `Create a new commit instead of amending the current one.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'c',
  },
  message: {
    type: 'string',
    alias: 'm',
    describe: 'The message for the commit.',
    demandOption: false,
  },
  edit: {
    alias: 'e',
    type: 'boolean',
    describe: 'Modify the existing commit message when amending.',
    demandOption: false,
  },
  patch: {
    describe: `Pick hunks to stage before committing.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'p',
  },
  'no-edit': {
    type: 'boolean',
    describe:
      "Don't modify the existing commit message. Takes precedence over --edit",
    demandOption: false,
    default: false,
    alias: 'n',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'modify';
export const canonical = 'modify';
export const aliases = ['m'];
export const description =
  'Modify the current branch by amending its commit (or creating a new one with --commit) and restack upstack branches.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> => {
  return graphite(argv, canonical, async (context) => {
    if (argv['interactive-rebase']) {
      return editBranchAction(context);
    }
    if (
      !argv.commit &&
      argv.edit === true &&
      !argv['no-edit'] &&
      !argv.message?.trim() &&
      !context.canEdit
    ) {
      throw new PreconditionsFailedError(
        'An explicit editor request requires interactive mode.'
      );
    }
    assertBranchesAvailableInWorktrees(
      context.engine.getRelativeStack(
        context.engine.currentBranchPrecondition,
        SCOPE.UPSTACK_EXCLUSIVE
      )
    );
    return argv.commit
      ? commitCreateAction(
          {
            message: argv.message,
            addAll: argv.all,
            patch: argv.patch,
          },
          context
        )
      : commitAmendAction(
          {
            message: argv.message,
            noEdit:
              argv['no-edit'] ||
              argv.edit === false ||
              (!context.canEdit && argv.edit === undefined),
            addAll: argv.all,
            patch: argv.patch,
          },
          context
        );
  });
};
