import fs from 'fs-extra';
import path from 'path';
import { runGitCommandAndSplitLines } from './runner';
import { getRebaseDirectory } from './rebase_in_progress';

export function getUnmergedFiles(): string[] {
  return runGitCommandAndSplitLines({
    args: [
      `--no-pager`,
      `diff`,
      `--no-ext-diff`,
      `--name-only`,
      `--diff-filter=U`,
    ],
    onError: 'throw',
    resource: 'getUnmergedFiles',
  });
}

export function getRebaseHead(): string | undefined {
  const directory = getRebaseDirectory();
  if (!directory) return undefined;
  const rebaseHeadPath = path.join(directory, 'head-name');

  return fs.existsSync(rebaseHeadPath)
    ? fs
        .readFileSync(rebaseHeadPath, {
          encoding: 'utf-8',
        })
        .replace(/\r?\n$/, '')
        .slice('refs/heads/'.length)
    : undefined;
}
