import { runGitCommand } from './runner';

export function pushBranch(opts: {
  remote: string;
  branchName: string;
  noVerify: boolean;
  forcePush: boolean;
  quiet?: boolean;
}): void {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';

  runGitCommand({
    args: [
      `push`,
      ...(opts.quiet ? ['--quiet'] : []),
      `-u`,
      opts.remote,
      forceOption,
      opts.branchName,
      ...(opts.noVerify ? ['--no-verify'] : []),
    ],
    options: { stdio: ['inherit', 'inherit', 'pipe'], forwardStderr: true },
    onError: 'throw',
    resource: 'pushBranch',
  });
}
