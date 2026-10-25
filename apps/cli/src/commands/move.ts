import chalk from 'chalk';
import yargs from 'yargs';
import { currentBranchOnto } from '../actions/current_branch_onto';
import { interactiveBranchSelection } from '../actions/log';
import { graphite } from '../lib/runner';
import { PreconditionsFailedError } from '../lib/errors';
import { SCOPE } from '../lib/engine/scope_spec';

const args = {
  branch: {
    describe: `Optional branch to rebase the current stack onto.`,
    demandOption: false,
    positional: true,
    hidden: true,
    type: 'string',
  },
  onto: {
    describe: `Target local tracked branch or trunk (also accepted positionally).`,
    type: 'string',
    alias: 'o',
    requiresArg: true,
  },
  only: {
    describe: `Move only the selected source and leave its children on its old parent; otherwise move its whole upstack.`,
    type: 'boolean',
    default: false,
    coerce: (value: boolean): boolean => {
      validateOnlyArguments(process.argv.slice(2));
      return value;
    },
  },
  source: {
    describe: `Optional branch to rebase (defaults to current branch).`,
    demandOption: false,
    positional: false,
    type: 'string',
    alias: 's',
    requiresArg: true,
  },
} as const;

export const command = 'move [branch]';
export const canonical = 'move';
export const description =
  'Rebase the current branch onto the latest commit of the target branch and restack all of its descendants. If no branch is passed in, opens an interactive selector.';
export const builder = args;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;
export const handler = async (argv: argsT): Promise<void> => {
  return graphite(argv, canonical, async (context) => {
    const positional = getBranchArgument(argv.branch, 'positional target');
    const onto = getBranchArgument(argv.onto, '--onto');
    const source = getBranchArgument(argv.source, '--source');
    if (positional !== undefined && onto !== undefined && positional !== onto) {
      throw new PreconditionsFailedError(
        'Positional target and --onto must name the same branch.'
      );
    }
    const selectedSource = source ?? context.engine.currentBranchPrecondition;
    context.engine.getBaseRevision(selectedSource);
    const dest =
      onto ??
      positional ??
      (await interactiveBranchSelection(
        {
          message: `Choose a new base for ${chalk.yellow(
            selectedSource
          )} (autocomplete or arrow keys)`,
          omitBranches: argv.only
            ? [selectedSource]
            : context.engine.getRelativeStack(selectedSource, SCOPE.UPSTACK),
          initialBranch: context.engine.getParentPrecondition(selectedSource),
        },
        context
      ));

    currentBranchOnto(dest, context, {
      source: selectedSource,
      only: argv.only,
    });
  });
};

function getBranchArgument(value: unknown, option: string): string | undefined {
  if (value === undefined) return undefined;
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const branch = values[0];
  if (
    typeof branch !== 'string' ||
    branch.length === 0 ||
    values.some((entry) => entry !== branch)
  ) {
    throw new PreconditionsFailedError(
      `${option} requires one nonempty, unambiguous branch name.`
    );
  }
  return branch;
}

function validateOnlyArguments(input: readonly string[]): void {
  // Yargs normalizes invalid booleans and keeps only the last repeated value.
  let previous: string | undefined;
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (token === '--') break;
    let value = 'true';
    if (token.startsWith('--only=')) value = token.slice('--only='.length);
    else if (token === '--no-only') value = 'false';
    else if (token === '--only') {
      const next = input[index + 1];
      if (next === 'true' || next === 'false' || next === '') {
        value = next;
        index++;
      }
    } else continue;
    if (
      (value !== 'true' && value !== 'false') ||
      (previous !== undefined && value !== previous)
    ) {
      throw new PreconditionsFailedError(
        '--only requires one nonempty, unambiguous boolean value (true or false).'
      );
    }
    previous = value;
  }
}
