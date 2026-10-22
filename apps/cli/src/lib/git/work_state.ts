import fs from 'fs';
import { runGitCommand } from './runner';

// Compare content rather than index bytes: Git may refresh stat data during commit.
export function getWorkState(): string {
  const commands = [
    ['rev-parse', 'HEAD'],
    ['symbolic-ref', 'HEAD'],
    ['ls-files', '--stage', '-v', '-z'],
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv'],
    ['diff', '--binary', '--no-ext-diff', '--no-textconv'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ];
  const state = commands.map((args) =>
    runGitCommand({
      args,
      options: { noTrim: true },
      onError: 'throw',
      resource: 'workState',
    })
  );
  const files = state[state.length - 1].split('\0').filter(Boolean);
  return JSON.stringify([
    state,
    files.map((file) => {
      const stat = fs.lstatSync(file);
      return [
        file,
        stat.mode,
        stat.isDirectory()
          ? null
          : stat.isSymbolicLink()
          ? fs.readlinkSync(file)
          : fs.readFileSync(file).toString('base64'),
      ];
    }),
  ]);
}
