import fs from 'fs-extra';
import { PreconditionsFailedError } from '../errors';
import { runGitCommand } from './runner';

/** Refuse predictable worktree conflicts before changing any branch or index. */
export function assertBranchesAvailableInWorktrees(
  branchNames: string[],
  cwd?: string
): void {
  if (branchNames.length === 0) {
    return;
  }
  for (const [branch, worktreePath] of getOtherWorktreeBranches(cwd)) {
    if (branchNames.includes(branch)) {
      throw new PreconditionsFailedError(
        `Cannot restack ${branch}: it is checked out in worktree ${worktreePath}. Switch that worktree to another branch or detach its HEAD, then retry.`
      );
    }
  }
}

/** Branches occupied outside the worktree selected by the effective cwd. */
export function getOtherWorktreeBranches(
  cwd?: string
): ReadonlyMap<string, string> {
  const branches = new Map<string, string>();
  const env = { ...process.env };
  if (cwd) {
    // Hooks set worktree-local Git overrides; an explicit source cwd owns its lookup.
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_PREFIX',
    ])
      delete env[key];
  }
  const currentPath = fs.realpathSync(
    runGitCommand({
      args: ['rev-parse', '--show-toplevel'],
      onError: 'throw',
      resource: 'currentWorktree',
      options: { cwd, env },
    })
  );
  const worktrees = runGitCommand({
    args: ['worktree', 'list', '--porcelain', '-z'],
    options: { noTrim: true, cwd, env },
    onError: 'throw',
    resource: 'listWorktrees',
  });
  for (const record of worktrees.split('\0\0')) {
    const fields = record.split('\0');
    const worktreePath = fields
      .find((field) => field.startsWith('worktree '))
      ?.slice('worktree '.length);
    const branch = fields
      .find((field) => field.startsWith('branch refs/heads/'))
      ?.slice('branch refs/heads/'.length);
    if (
      worktreePath &&
      branch &&
      (!fs.existsSync(worktreePath) ||
        fs.realpathSync(worktreePath) !== currentPath)
    ) {
      branches.set(branch, worktreePath);
    }
  }
  return branches;
}
