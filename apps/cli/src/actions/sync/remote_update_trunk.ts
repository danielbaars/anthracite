import { randomUUID } from 'crypto';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { fetchBranch, readFetchHead } from '../../lib/git/fetch_branch';
import { getShaOrThrow } from '../../lib/git/get_sha';
import { getMergeBase } from '../../lib/git/merge_base';
import { runGitCommand } from '../../lib/git/runner';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';

export type RemoteTrunkUpdate = {
  readonly branchName: string;
  readonly previousHead: string;
  readonly head: string;
  readonly sourceRef: string;
  readonly reset?: boolean;
};

export function snapshotRemoteTrunk(
  context: TContext,
  policy: 'get' | 'sync' = 'get'
): RemoteTrunkUpdate {
  const branchName = context.engine.trunk;
  const previousHead = getShaOrThrow(`refs/heads/${branchName}`);
  fetchBranch(context.repoConfig.getRemote(), branchName);
  const head = readFetchHead();
  let canFastForward = false;
  try {
    canFastForward = getMergeBase(previousHead, head) === previousHead;
  } catch {
    /* Unrelated histories cannot fast-forward. */
  }
  if (!canFastForward && policy === 'get')
    throw new ExitFailedError(
      `Cannot advance trunk ${branchName}: local trunk is ahead of or diverged from its remote. Get never resets trunk, even with --force.`
    );
  const sourceRef = `refs/gt-metadata/get/${randomUUID()}/trunk`;
  runGitCommand({
    args: ['update-ref', sourceRef, head],
    onError: 'throw',
    resource: 'pinGetTrunk',
  });
  return {
    branchName,
    previousHead,
    head,
    sourceRef,
    ...(policy === 'sync' ? { reset: !canFastForward } : {}),
  };
}

export function assertRemoteTrunkUnchanged(trunk: RemoteTrunkUpdate): void {
  if (
    getShaOrThrow(trunk.sourceRef) !== trunk.head ||
    getShaOrThrow(`refs/heads/${trunk.branchName}`) !== trunk.previousHead
  )
    throw new ExitFailedError(
      `Trunk ${trunk.branchName} changed while getting the stack. Please retry.`
    );
  if (trunk.head !== trunk.previousHead)
    assertBranchesAvailableInWorktrees([trunk.branchName]);
}

export function applyRemoteTrunk(
  trunk: RemoteTrunkUpdate,
  context: TContext
): void {
  assertRemoteTrunkUnchanged(trunk);
  if (trunk.head === trunk.previousHead) return;
  context.engine.applyTrunkUpdate(trunk);
  context.splog.info(
    `${trunk.reset ? 'Reset' : 'Fast-forwarded'} trunk ${
      trunk.branchName
    } from remote.`
  );
}

export function releaseRemoteTrunk(trunk: RemoteTrunkUpdate): void {
  runGitCommand({
    args: ['update-ref', '-d', trunk.sourceRef, trunk.head],
    onError: 'throw',
    resource: 'releaseGetTrunk',
  });
}
