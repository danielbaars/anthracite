import { runGitCommand } from './runner';

export function getCurrentBranchName(): string | undefined {
  const branchName = runGitCommand({
    args: [`branch`, `--show-current`],
    onError: 'ignore',
    resource: 'getCurrentBranchName',
    options: { noTrim: true },
  }).replace(/\r?\n$/, '');

  return branchName.length > 0 ? branchName : undefined;
}

export function moveBranch(newName: string): void {
  runGitCommand({
    args: [`branch`, `-m`, newName],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'moveBranch',
  });
}

export function deleteBranch(branchName: string): void {
  runGitCommand({
    args: [`branch`, `-D`, branchName],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'deleteBranch',
  });
}

export function switchBranch(
  branch: string,
  opts?: {
    new?: boolean;
    detach?: boolean;
    force?: boolean;
    startPoint?: string;
    preserveIgnored?: boolean;
  }
): void {
  runGitCommand({
    args: [
      `switch`,
      ...(opts?.detach ? ['-d'] : []),
      ...(opts?.preserveIgnored ? ['--no-overwrite-ignore'] : []),
      ...(opts?.force ? ['-f'] : []),
      ...(opts?.new ? ['-c'] : []),
      branch,
      ...(opts?.startPoint ? [opts.startPoint] : []),
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'switchBranch',
  });
}

export function forceCheckoutNewBranch(branchName: string, sha: string): void {
  runGitCommand({
    args: [`switch`, `-C`, branchName, sha],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'forceCheckoutNewBranch',
  });
}

export function forceCreateBranch(branchName: string, sha: string): void {
  runGitCommand({
    args: [`branch`, `-f`, branchName, sha],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'forceCreateBranch',
  });
}

export function fastForward(revision: string): void {
  runGitCommand({
    args: ['merge', '--ff-only', '--no-edit', revision],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'fastForward',
  });
}
