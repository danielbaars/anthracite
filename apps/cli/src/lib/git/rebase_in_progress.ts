import fs from 'fs-extra';
import path from 'path';
import { runGitCommand } from './runner';

export function rebaseInProgress(options?: { cwd: string }): boolean {
  const gitDir = path.resolve(
    options?.cwd ?? process.cwd(),
    runGitCommand({
      args: [`rev-parse`, `--git-dir`],
      options,
      onError: 'throw',
      resource: 'rebaseInProgress',
    })
  );
  return ['rebase-merge', 'rebase-apply'].some((directory) =>
    fs.existsSync(path.join(gitDir, directory))
  );
}
