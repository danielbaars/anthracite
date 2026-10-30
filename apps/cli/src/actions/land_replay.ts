import { TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { composeGit } from '../lib/git/git';
import { assertBranchEditable } from '../lib/engine/frozen_branch';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { ownsRebase } from '../lib/git/rebase_ownership';
import { continueConfigFactory } from '../lib/spiffy/continuation_spf';
import {
  landingGit as git,
  loadLandingProgress,
  saveLandingProgress,
} from '../lib/landing_progress';

/** A pending landing permits only its exact owned local rebase continuation. */
export function allowLandingContinuation(): boolean {
  const record = loadLandingProgress();
  if (!record?.replay) return false;
  const data = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  const active = composeGit().getRebaseHead();
  if (
    !ownsRebase(data.rebaseOwnership) ||
    active !== record.replay.pending[0] ||
    data.rebasedBranchBase !== record.replay.onto ||
    data.branchesToSync.length ||
    JSON.stringify(data.branchesToRestack) !==
      JSON.stringify(record.replay.pending.slice(1)) ||
    data.absorb ||
    data.delete ||
    data.split ||
    data.insert ||
    data.reorder ||
    data.fold ||
    data.move
  )
    throw new ExitFailedError(
      'Pending landing has no matching owned active local replay. Recovery preserved; inspect an land in the original project.'
    );
  for (const branch of record.replay.pending) assertBranchEditable(branch);
  assertBranchesAvailableInWorktrees(record.replay.pending);
  return true;
}

export function recordLandingReplayCompletion(
  branch: string,
  context: TContext
): void {
  const record = loadLandingProgress();
  if (!record?.replay) return;
  if (record.replay.pending[0] !== branch)
    throw new ExitFailedError(
      'Landing replay scope changed; recovery preserved.'
    );
  const member = [...record.merges, ...record.maintenance].find(
    (item) => item.branch === branch
  );
  if (!member)
    throw new ExitFailedError(
      'Landing replay participant missing; recovery preserved.'
    );
  const expected = member.reached ?? member;
  if (context.engine.getParentPrecondition(branch) !== expected.parent)
    throw new ExitFailedError(
      'Landing replay parent changed; recovery preserved.'
    );
  const reached = {
    head: git(['rev-parse', `refs/heads/${branch}`]),
    metadata: git(['rev-parse', `refs/branch-metadata/${branch}`]),
    parent: expected.parent,
    base: context.engine.getBaseRevision(branch),
    remoteHead: expected.remoteHead,
  };
  const replace = (item: typeof member): typeof member =>
    item.branch === branch ? { ...item, reached } : item;
  const pending = record.replay.pending.slice(1);
  saveLandingProgress(
    {
      ...record,
      merges: record.merges.map(replace),
      maintenance: record.maintenance.map(replace),
      replay: pending.length
        ? {
            pending,
            onto: context.engine.getRevision(
              context.engine.getParentPrecondition(pending[0])
            ),
          }
        : undefined,
    },
    record
  );
}
