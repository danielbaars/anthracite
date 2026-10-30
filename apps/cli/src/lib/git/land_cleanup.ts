import { withFrozenCommitGuard } from './frozen_commit';
import { withFrozenPushGuard } from './frozen_push';
import { runGitCommand } from './runner';

export function deleteLandedLeafRefs(
  branch: string,
  expected: { readonly head: string; readonly metadata: string }
): void {
  withFrozenCommitGuard(
    branch,
    (prefix) => {
      runGitCommand({
        args: [...prefix, 'update-ref', '--stdin', '-z'],
        options: {
          input: `start\0delete refs/heads/${branch}\0${expected.head}\0delete refs/branch-metadata/${branch}\0${expected.metadata}\0prepare\0commit\0`,
        },
        onError: 'throw',
        resource: 'deleteLandedLeaf',
      });
    },
    { allRefs: true, participants: [branch] }
  );
}
export function deleteLandedRemote(
  remote: string,
  branch: string,
  expected: string
): void {
  withFrozenPushGuard({ branch, noVerify: false }, (prefix) => {
    runGitCommand({
      args: [
        ...prefix,
        'push',
        remote,
        `--force-with-lease=refs/heads/${branch}:${expected}`,
        `:refs/heads/${branch}`,
      ],
      options: { forwardStderr: true },
      onError: 'throw',
      resource: 'deleteLandedRemote',
    });
  });
}
