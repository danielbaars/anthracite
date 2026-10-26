import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';

export type TCommitOpts = {
  amend?: boolean;
  message?: string;
  noEdit?: boolean;
  edit?: boolean;
  patch?: boolean;
  readonly participants?: readonly string[];
};
export function commit(
  opts: TCommitOpts & {
    noVerify: boolean;
    readonly quiet?: boolean;
    readonly frozenGuardBranch?: string;
  }
): void {
  const run = (prefix: readonly string[]): void => {
    runGitCommand({
      args: [
        ...prefix,
        'commit',
        ...(opts.quiet ? ['--quiet'] : []),
        ...(opts.amend ? [`--amend`] : []),
        ...(opts.message ? [`-m`, opts.message] : []),
        ...(opts.noEdit ? [`--no-edit`] : []),
        ...(opts.edit ? [`-e`] : []),
        ...(opts.patch ? [`-p`] : []),
        ...(opts.noVerify ? ['-n'] : []),
      ],
      options: {
        stdio: 'inherit',
      },
      onError: 'throw',
      resource: 'commit',
    });
  };
  if (opts.frozenGuardBranch)
    withFrozenCommitGuard(opts.frozenGuardBranch, run, {
      participants: opts.participants,
    });
  else run([]);
}
