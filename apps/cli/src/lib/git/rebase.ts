import { SpawnSyncOptions } from 'child_process';
import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';

import { rebaseInProgress } from './rebase_in_progress';

type TRebaseResult = 'REBASE_CONFLICT' | 'REBASE_DONE';
export function rebase(args: {
  onto: string;
  from: string;
  branchName: string;
  restackCommitterDateIsAuthorDate?: boolean;
  participants?: readonly string[];
}): TRebaseResult {
  let result: TRebaseResult = 'REBASE_DONE';
  withFrozenCommitGuard(
    args.branchName,
    (prefix) => {
      result = rebaseInternal({
        args: [
          ...(args.restackCommitterDateIsAuthorDate
            ? [`--committer-date-is-author-date`]
            : []),
          `--onto`,
          args.onto,
          args.from,
          args.branchName,
        ],
        prefix,
        resource: 'rebase',
      });
    },
    { preRebase: true, participants: args.participants }
  );
  return result;
}

export function rebaseContinue(
  branchName?: string,
  participants?: readonly string[]
): TRebaseResult {
  const run = (prefix: readonly string[]): TRebaseResult =>
    rebaseInternal({
      args: ['--continue'],
      prefix,
      options: {
        env: { ...process.env, GIT_EDITOR: 'true' },
      },
      resource: 'rebaseContinue',
    });
  if (!branchName) return run([]);
  let result: TRebaseResult = 'REBASE_DONE';
  withFrozenCommitGuard(
    branchName,
    (prefix) => {
      result = run(prefix);
    },
    { participants }
  );
  return result;
}

export function rebaseAbort(): void {
  runGitCommand({
    args: [`rebase`, `--abort`],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'rebaseAbort',
  });
}

export function rebaseInteractive(args: {
  parentBranchRevision: string;
  branchName: string;
}): TRebaseResult {
  let result: TRebaseResult = 'REBASE_DONE';
  withFrozenCommitGuard(
    args.branchName,
    (prefix, env) => {
      result = rebaseInternal({
        args: [`-i`, args.parentBranchRevision, args.branchName],
        prefix,
        resource: 'rebaseInteractive',
        options: { stdio: 'inherit', env },
      });
    },
    { sequenceEditor: true }
  );
  return result;
}

function rebaseInternal(params: {
  args: string[];
  prefix?: readonly string[];
  options?: Pick<SpawnSyncOptions, 'stdio' | 'env'>;
  resource: string;
}) {
  try {
    runGitCommand({
      args: [...(params.prefix ?? []), 'rebase', ...params.args],
      options: { stdio: 'pipe', ...params.options },
      onError: 'throw',
      resource: params.resource,
    });
  } catch (e) {
    if (rebaseInProgress()) {
      return 'REBASE_CONFLICT';
    } else {
      throw e;
    }
  }
  return 'REBASE_DONE';
}
