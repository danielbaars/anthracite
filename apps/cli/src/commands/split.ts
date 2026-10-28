import yargs from 'yargs';
import { splitCurrentBranch } from '../actions/split';
import { graphite } from '../lib/runner';
import { splitByFile } from '../actions/split_file';

const args = {
  ['by-file']: {
    describe:
      'Extract committed paths into a new parent without prompting. Repeat selectors or supply multiple Git pathspecs.',
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
  'Split the current branch by commit, hunk or selected files. Frozen sources require an unfreeze first.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .options(args)
    .epilog(
      [
        'File mode: split/sp --by-file/--file/-f <pathspec...>. Git pathspecs resolve from the effective cwd; quote patterns to pass them literally.',
        'File mode flattens the source history into one selected commit and one remainder commit, joining messages oldest to newest. Both use the invoking Git identity. Use --by-commit to preserve commit boundaries.',
        'The original branch, tip tree and local PR identity remain; an editable parent receives a safe repeated _split suffix. A complete selection or no net matching changes is refused before effects.',
        'Descendants are mandatory. A real replay conflict retains the extraction: resolve and run an continue as reported. A hook failure may require manual recovery at the reported path. Hooks run in detached temporary work; there is no universal rollback. See https://github.com/danielbaars/anthracite/blob/main/docs/split.md.',
      ].join('\n\n')
    );
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => {
    if (argv['by-file'] !== undefined)
      return splitByFile(argv['by-file'], argv.verify === false, context);
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
