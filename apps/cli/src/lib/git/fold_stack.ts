import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';

/** Publish just the selected branch refs together, checking every original tip. */
export function publishFoldStackRefs(
  chain: readonly { readonly name: string; readonly revision: string }[],
  survivor: string,
  opts: { readonly tip: string; readonly participants: readonly string[] }
): void {
  const commands = chain.map(({ name, revision }) =>
    name === survivor
      ? `update refs/heads/${name}\0${opts.tip}\0${revision}\0`
      : `delete refs/heads/${name}\0${revision}\0`
  );
  withFrozenCommitGuard(
    survivor,
    (prefix) => {
      runGitCommand({
        args: [...prefix, 'update-ref', '--stdin', '-z'],
        options: { input: `start\0${commands.join('')}prepare\0commit\0` },
        onError: 'throw',
        resource: 'foldStackRefs',
      });
    },
    { participants: opts.participants, allRefs: true }
  );
}
