import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';

export function softReset(sha: string, frozenGuardBranch?: string): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [...prefix, `reset`, `-q`, `--soft`, sha],
      onError: 'throw',
      resource: 'softReset',
    });
  };
  if (frozenGuardBranch) withFrozenCommitGuard(frozenGuardBranch, run);
  else run([]);
}

export function mixedReset(sha?: string): void {
  runGitCommand({
    args: [`reset`, `-q`, `--mixed`, ...(sha ? [sha] : [])],
    onError: 'throw',
    resource: 'mixedReset',
  });
}

export function hardReset(sha?: string): void {
  runGitCommand({
    args: [`reset`, `-q`, `--hard`, ...(sha ? [sha] : [])],
    onError: 'throw',
    resource: 'hardReset',
  });
}

export function trackedReset(sha: string, frozenGuardBranch?: string): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [...prefix, `reset`, `-Nq`, sha],
      onError: 'throw',
      resource: 'trackedReset',
    });
  };
  if (frozenGuardBranch) withFrozenCommitGuard(frozenGuardBranch, run);
  else run([]);
}
