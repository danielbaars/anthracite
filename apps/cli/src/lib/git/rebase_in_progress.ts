import fs from 'fs-extra';
import path from 'path';
import { runGitCommand } from './runner';

export function getRebaseDirectory(options?: {
  readonly cwd: string;
}): string | undefined {
  const gitDir = path.resolve(
    options?.cwd ?? process.cwd(),
    runGitCommand({
      args: [`rev-parse`, `--git-dir`],
      options,
      onError: 'throw',
      resource: 'rebaseInProgress',
    })
  );
  return ['rebase-merge', 'rebase-apply']
    .map((directory) => path.join(gitDir, directory))
    .find((directory) => fs.existsSync(directory));
}

export function rebaseInProgress(options?: { cwd: string }): boolean {
  return getRebaseDirectory(options) !== undefined;
}
