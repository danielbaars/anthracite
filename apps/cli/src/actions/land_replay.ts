import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { composeGit } from '../lib/git/git';
import {
  assertBranchEditable,
  getMandatoryBranches,
} from '../lib/engine/frozen_branch';
import {
  getMetadataRefList,
  readMetadataRef,
} from '../lib/engine/metadata_ref';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { ownsRebase } from '../lib/git/rebase_ownership';
import { continueConfigFactory } from '../lib/spiffy/continuation_spf';
import {
  landingGit as git,
  loadLandingProgress,
  saveLandingProgress,
  owned,
  landingSurvivors,
  assertLandingRemoteIdentity,
} from '../lib/landing_progress';

/** A pending landing permits only its exact owned local rebase continuation. */
export function allowLandingContinuation(
  updatingContinuation = false
): boolean {
  const record = loadLandingProgress();
  if (!record?.replay) return false;
  const data = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  const active = composeGit().getRebaseHead();
  if (!composeGit().rebaseInProgress() && record.replay.ready) {
    if (record.replay.ready !== landingContinuationDigest())
      throw new ExitFailedError(
        'Landing local queue continuation changed; both recovery records preserved.'
      );
    assertLandingReplayParticipants();
    return true;
  }
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
      `Pending landing has no matching owned active local replay or proven pending queue. Raw Git abort cancels only its active rebase; completed effects and both recovery records remain. Inspect git status, git log --oneline --all and saved branch metadata in ${record.directory}; use an land ${record.target} --dry-run to inspect remote progress. Do not clear recovery or repeat patches to bypass this guard.`
    );
  assertLandingReplayParticipants(updatingContinuation);
  return true;
}

/** Hooks can change a queued participant after an earlier replay completes. */
export function assertLandingReplayParticipants(
  updatingContinuation = false
): void {
  const record = loadLandingProgress();
  if (!record?.replay) return;
  assertLandingRemoteIdentity(record);
  if (
    !updatingContinuation &&
    record.replay.continuation &&
    record.replay.continuation !== landingContinuationDigest()
  )
    throw new ExitFailedError(
      'Landing local queue continuation changed; both recovery records preserved.'
    );
  const survivors = landingSurvivors(record);
  const names = new Set(survivors.map((member) => member.branch));
  for (const branch of record.replay.pending) {
    const member = survivors.find((item) => item.branch === branch);
    if (
      !member ||
      git(['rev-parse', `refs/heads/${branch}`]) !== owned(member).head ||
      git(['rev-parse', `refs/branch-metadata/${branch}`]) !==
        owned(member).metadata
    )
      throw new ExitFailedError(
        'Landing replay participant changed; replay queue remains incomplete; recovery preserved.'
      );
    assertBranchEditable(branch);
  }
  for (const branch of Object.keys(getMetadataRefList())) {
    const parent = readMetadataRef(branch).parentBranchName;
    if (parent && record.replay.pending.includes(parent) && !names.has(branch))
      throw new ExitFailedError(
        'Landing replay scope changed; no undisclosed descendants may be edited.'
      );
  }
  assertBranchesAvailableInWorktrees(record.replay.pending);
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
  const continuationUnchanged =
    record.replay.continuation !== undefined &&
    record.replay.continuation === landingContinuationDigest();
  const pending = record.replay.pending.slice(1);
  saveLandingProgress(
    {
      ...record,
      merges: record.merges.map(replace),
      maintenance: record.maintenance.map(replace),
      continuationCleanup:
        !pending.length && continuationUnchanged
          ? record.replay.continuation
          : undefined,
      replay: !continuationUnchanged
        ? record.replay
        : pending.length
        ? {
            pending,
            ready:
              record.replay.continuation === landingContinuationDigest()
                ? record.replay.continuation
                : undefined,
            continuation: record.replay.continuation,
            onto: context.engine.getRevision(
              context.engine.getParentPrecondition(pending[0])
            ),
          }
        : undefined,
    },
    record
  );
  if (!continuationUnchanged)
    throw new ExitFailedError(
      'Landing continuation changed during local replay; reached refs and both recovery records preserved. Inspect the original project before recovery.'
    );
}

/** A completed replay durably proves the next queue has not started. */
function startLandingReplay(branch: string): string | undefined {
  const record = loadLandingProgress();
  if (!record?.replay?.ready) return;
  if (record.replay.pending[0] !== branch)
    throw new ExitFailedError(
      'Landing local queue changed; recovery preserved.'
    );
  saveLandingProgress(
    { ...record, replay: { ...record.replay, ready: undefined } },
    record
  );
  return record.replay.ready;
}
function landingContinuationDigest(): string | undefined {
  const file = path.resolve(git(['rev-parse', '--git-path', '.gtcontinue']));
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile())
    return undefined;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** A rejected replay may retry only when no ref/metadata or owned queue changed. */
function retainRejectedLandingReplay(branch: string, ready?: string): void {
  if (
    !ready ||
    composeGit().rebaseInProgress() ||
    ready !== landingContinuationDigest()
  )
    return;
  const record = loadLandingProgress();
  if (
    !record?.replay ||
    record.replay.pending[0] !== branch ||
    record.replay.ready
  )
    return;
  for (const member of landingSurvivors(record)) {
    if (
      git(['rev-parse', `refs/heads/${member.branch}`]) !==
        owned(member).head ||
      git(['rev-parse', `refs/branch-metadata/${member.branch}`]) !==
        owned(member).metadata
    )
      return;
  }
  saveLandingProgress(
    { ...record, replay: { ...record.replay, ready } },
    record
  );
}

export function restackLandingBranch(
  branch: string,
  context: TContext,
  options: { readonly preserveOtherRefs?: boolean } = {}
): ReturnType<TContext['engine']['restackBranch']> {
  const ready = startLandingReplay(branch);
  try {
    return context.engine.restackBranch(
      branch,
      getMandatoryBranches(context.continueConfig.data),
      options.preserveOtherRefs
    );
  } catch (error: unknown) {
    retainRejectedLandingReplay(branch, ready);
    throw error;
  }
}

/** Bind the ordinary continuation bytes while its exact owned conflict is active. */
export function recordLandingContinuation(): void {
  const record = loadLandingProgress();
  if (!record?.replay) return;
  allowLandingContinuation(true);
  saveLandingProgress(
    {
      ...record,
      replay: { ...record.replay, continuation: landingContinuationDigest() },
    },
    record
  );
}

/** Landing owns only absence before first publication, or its exact saved bytes. */
export function assertLandingContinuationWritable(): void {
  const record = loadLandingProgress();
  if (!record?.replay) return;
  const file = path.resolve(git(['rev-parse', '--git-path', '.gtcontinue']));
  if (
    record.replay.continuation
      ? record.replay.continuation !== landingContinuationDigest()
      : fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined
  )
    throw new ExitFailedError(
      'Landing continuation publication refused; foreign, missing or changed continuation and active Git replay preserved.'
    );
}

export function finishLandingContinuation(context: TContext): void {
  const record = loadLandingProgress();
  if (!record) return;
  assertLandingRemoteIdentity(record);
  if (
    record.replay ||
    !record.continuationCleanup ||
    record.continuationCleanup !== landingContinuationDigest()
  )
    throw new ExitFailedError(
      'Landing continuation completion refused; local replay or changed continuation and both recovery records preserved.'
    );
  context.continueConfig.delete();
  saveLandingProgress({ ...record, continuationCleanup: undefined }, record);
}
