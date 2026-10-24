import yargs from 'yargs';
import { showBranchInfo } from '../actions/show_branch';
import { graphiteInspection } from '../lib/runner';

const args = {
  branch: {
    describe: `Local tracked branch to inspect. Defaults to the current branch.`,
    type: 'string',
    requiresArg: true,
  },
  patch: {
    describe: `Show the changes made by each commit.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'p',
  },
  diff: {
    describe: `Show the diff between this branch and its parent. Takes precedence over patch`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'd',
  },
  stat: {
    describe: `Show a diffstat instead of full patches.`,
    default: false,
    type: 'boolean',
    alias: 's',
  },
  body: {
    describe: `Show the PR body, if it exists.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'b',
  },
} as const;
type argsT = yargs.Arguments<
  yargs.InferredOptionTypes<typeof args> & { readonly branchName?: string }
>;

export const command = 'info [branchName]';
export const canonical = 'info';
export const aliases = ['i'];
export const description =
  'Display information about the current or selected branch.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .showHelpOnFail(false)
    .parserConfiguration({ 'parse-positional-numbers': false })
    .options(args)
    .positional('branchName', { type: 'string' })
    .check((argv) => {
      for (const argument of process.argv.slice(2)) {
        if (argument === '--') break;
        // Yargs also exposes the positional key as an otherwise undocumented option.
        if (/^--(?:no-)?branch(?:Name|-name)(?:=|$)/.test(argument))
          throw new Error('Use a positional branch name or --branch.');
        if (
          /^(?:--(?:no-)?(?:patch|diff|stat|body|quiet|interactive|verify|debug|p|d|s|b|q)|-[pdsbq]+)=(?!true$|false$)/.test(
            argument
          )
        )
          throw new Error('info boolean options require true or false.');
      }
      if (
        argv._.length > 2 ||
        (argv.branchName !== undefined && argv._.length > 1)
      )
        throw new Error('info accepts at most one positional branch.');
      const positional = argv.branchName ?? argv._[1];
      if (Array.isArray(argv.branch))
        throw new Error('info accepts --branch only once.');
      if (argv.branch === '' || positional === '')
        throw new Error('info requires a nonempty branch name.');
      if (
        argv.branch !== undefined &&
        positional !== undefined &&
        argv.branch !== positional
      )
        throw new Error('info branch selectors must name the same branch.');
      return true;
    });
export const handler = async (argv: argsT): Promise<void> => {
  return graphiteInspection(argv, async (context) => {
    await showBranchInfo(
      argv.branch ??
        argv.branchName ??
        (typeof argv._[1] === 'string' ? argv._[1] : undefined) ??
        context.engine.currentBranchPrecondition,
      {
        patch: argv.patch,
        diff: argv.diff,
        body: argv.body,
        stat: argv.stat,
        quiet: argv.quiet === true,
      },
      context
    );
  });
};
