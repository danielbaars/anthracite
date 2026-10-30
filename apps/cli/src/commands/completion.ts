import path from 'path';
import { Argv, Arguments, CommandModule } from 'yargs';
import { composeGit } from '../lib/git/git';
import { runGitCommandAndSplitLines } from '../lib/git/runner';

export function registerCompletion(
  yargs: Argv,
  modules: readonly CommandModule[]
): Argv {
  const rootNames = modules
    .filter((module) => module.describe !== false)
    .flatMap((module) => [
      ...(typeof module.command === 'string'
        ? [module.command]
        : module.command ?? []
      ).map((command) => command.split(' ')[0]),
      ...(typeof module.aliases === 'string'
        ? [module.aliases]
        : module.aliases ?? []),
    ]);
  return yargs.completion(
    'completion',
    'Set up bash or zsh tab completion.',
    //@ts-expect-error types/yargs is out of date with yargs
    // eslint-disable-next-line max-params
    (current, argv, defaultCompletion, done) => {
      const isRootWord = isCompletingRootWord(current, argv);
      if (!isRootWord && shouldCompleteBranch(current, argv)) {
        // Branch candidates do not require loading a mutating repository context.
        if (
          path.basename(process.env.SHELL ?? '') === 'fish' &&
          ['get', 'g'].includes('' + argv['_'][1])
        ) {
          return done(
            runGitCommandAndSplitLines({
              args: [
                'for-each-ref',
                '--format=%(refname:strip=3)',
                'refs/remotes/',
              ],
              onError: 'throw',
              resource: null,
            })
          );
        }
        return done(Object.keys(composeGit().getBranchNamesAndRevisions()));
      }
      if (isRootWord && !current.startsWith('-')) {
        return defaultCompletion(
          (error: Error | null, candidates: string[]) => {
            if (error) throw error;
            done([
              ...candidates,
              ...rootNames.filter(
                (alias, index) =>
                  rootNames.indexOf(alias) === index &&
                  !candidates.some(
                    (candidate) => candidate.split(':')[0] === alias
                  )
              ),
            ]);
          }
        );
      }
      return defaultCompletion();
    }
  );
}

const BRANCH_COMPLETING_COMMANDS = [
  'freeze',
  'unfreeze',
  'checkout',
  'co',
  'delete',
  'dl',
  'track',
  'tr',
  'untrack',
  'utr',
  'ut',
  'move',
  'get',
  'g',
  'pr',
  'review',
];

function shouldCompleteBranch(current: string, argv: Arguments): boolean {
  // Create and submit have branch-valued selectors; names remain literal.
  return (
    argv['_'].length <= 3 &&
    (BRANCH_COMPLETING_COMMANDS.includes('' + argv['_'][1]) ||
      (['submit', 's', 'ss'].includes('' + argv['_'][1]) &&
        (argv.branch === current || argv['roles-branch'] === current)) ||
      (['create', 'c'].includes('' + argv['_'][1]) &&
        (argv.onto === current ||
          (Array.isArray(argv['insert-child']) &&
            argv['insert-child'].includes(current))))) &&
    typeof current === 'string' &&
    !current.startsWith('-')
  );
}

function isCompletingRootWord(current: string, argv: Arguments): boolean {
  // An option can own an alias-looking value, even one equal to the command.
  return (
    argv['_'].length === 2 &&
    argv['_'][1] === current &&
    !Object.entries(argv).some(
      ([key, value]) =>
        key !== '_' &&
        key !== '$0' &&
        (value === current || (Array.isArray(value) && value.includes(current)))
    )
  );
}
