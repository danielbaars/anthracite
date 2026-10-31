import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';

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

export function deleteBranch(
  branchName: string,
  frozenGuardBranch?: string,
  participants?: readonly string[]
): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [...prefix, 'branch', '-D', branchName],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'deleteBranch',
    });
  };
  if (frozenGuardBranch)
    withFrozenCommitGuard(frozenGuardBranch, run, {
      participants,
      allRefs: true,
    });
  else run([]);
}

export function switchBranch(
  branch: string,
  opts?: {
    new?: boolean;
    detach?: boolean;
    force?: boolean;
    startPoint?: string;
    preserveIgnored?: boolean;
    noGuess?: boolean;
    frozenGuardBranch?: string;
  }
): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [
        ...prefix,
        `switch`,
        ...(opts?.detach ? ['-d'] : []),
        ...(opts?.noGuess ? ['--no-guess'] : []),
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
  };
  if (opts?.frozenGuardBranch)
    withFrozenCommitGuard(opts.frozenGuardBranch, run);
  else run([]);
}

export function forceCheckoutNewBranch(
  branchName: string,
  sha: string,
  opts?: { preserveIgnored?: boolean; participants?: readonly string[] }
): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [
        ...prefix,
        `switch`,
        ...(opts?.preserveIgnored ? ['--no-overwrite-ignore'] : []),
        `-C`,
        branchName,
        sha,
      ],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'forceCheckoutNewBranch',
    });
  };
  if (opts?.participants?.length)
    withFrozenCommitGuard(branchName, run, {
      participants: opts.participants,
      allRefs: true,
    });
  else run([]);
}

export function forceCreateBranch(
  branchName: string,
  sha: string,
  frozenGuardBranch?: string
): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [...prefix, 'branch', '-f', branchName, sha],
      options: { stdio: 'pipe' },
      onError: 'throw',
      resource: 'forceCreateBranch',
    });
  };
  if (frozenGuardBranch)
    withFrozenCommitGuard(frozenGuardBranch, run, { allRefs: true });
  else run([]);
}

export function fastForward(revision: string): void {
  runGitCommand({
    args: [
      'merge',
      '--ff-only',
      '--no-edit',
      '--no-overwrite-ignore',
      revision,
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'fastForward',
  });
}
