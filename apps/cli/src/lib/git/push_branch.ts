import { runGitCommand } from './runner';
import { withFrozenPushGuard } from './frozen_push';

export function pushBranch(opts: {
  remote: string;
  branchName: string;
  noVerify: boolean;
  forcePush: boolean;
  quiet?: boolean;
}): void {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';

  withFrozenPushGuard(
    { branch: opts.branchName, noVerify: opts.noVerify },
    (prefix) => {
      runGitCommand({
        args: [
          ...prefix,
          `push`,
          ...(opts.quiet ? ['--quiet'] : []),
          `-u`,
          opts.remote,
          forceOption,
          opts.branchName,
        ],
        options: { stdio: ['inherit', 'inherit', 'pipe'], forwardStderr: true },
        onError: 'throw',
        resource: 'pushBranch',
      });
    }
  );
}
