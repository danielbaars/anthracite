import { Argv, Arguments, CommandModule } from 'yargs';
import { composeGit } from '../lib/git/git';

export function registerCompletion(
  yargs: Argv,
  modules: readonly CommandModule[]
): Argv {
  const aliases = modules.flatMap((module) =>
    typeof module.aliases === 'string' ? [module.aliases] : module.aliases ?? []
  );
  return yargs.completion(
    'completion',
    'Set up bash or zsh tab completion.',
    //@ts-expect-error types/yargs is out of date with yargs
    // eslint-disable-next-line max-params
    (current, argv, defaultCompletion, done) => {
      if (shouldCompleteBranch(current, argv)) {
        // Branch candidates do not require loading a mutating repository context.
        return done(Object.keys(composeGit().getBranchNamesAndRevisions()));
      }
      if (argv['_'].length <= 2 && !current.startsWith('-')) {
        return defaultCompletion(
          (error: Error | null, candidates: string[]) => {
            if (error) throw error;
            done([
              ...candidates,
              ...aliases.filter(
                (alias, index) =>
                  aliases.indexOf(alias) === index &&
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
];

function shouldCompleteBranch(current: string, argv: Arguments): boolean {
  // this handles both with and without --branch because it's the only string arg
  return (
    argv['_'].length <= 3 &&
    BRANCH_COMPLETING_COMMANDS.includes('' + argv['_'][1]) &&
    typeof current === 'string' &&
    !current.startsWith('-')
  );
}
