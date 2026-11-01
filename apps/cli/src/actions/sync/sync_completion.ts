import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { sameMetadataExceptFrozen } from '../../lib/engine/metadata_comparison';
import { getMetadataRefList } from '../../lib/engine/metadata_ref';
import { getCurrentBranchName } from '../../lib/git/branch_ops';
import { getSha } from '../../lib/git/get_sha';
import { SyncCleanupPlan, SyncCleanupProgress } from './clean_branches';
import {
  GetCheckoutIntent,
  assertGetCheckout,
  finishGetCheckout,
} from './get_checkout';
import { SyncRefreshPlan } from './sync_refresh';

export type SyncCompletion = {
  readonly checkout: GetCheckoutIntent;
  readonly expected: { branchName: string; head: string; metadata: string }[];
  readonly sources: readonly { sourceRef: string; head: string }[];
};

/** Capture reached authorized cleanup before maintenance and final checkout hooks. */
export function createSyncCompletion(
  plan: {
    readonly refresh: SyncRefreshPlan;
    readonly cleanup: SyncCleanupPlan;
    readonly progress: SyncCleanupProgress;
  },
  context: TContext
): SyncCompletion {
  const { refresh, cleanup, progress } = plan;
  const original = refresh.original;
  const removedOriginal =
    'branchName' in original && progress.deleted.includes(original.branchName);
  const names = new Set([
    context.engine.trunk,
    ...cleanup.branches.map((entry) => entry.branchName),
    ...('branchName' in original ? [original.branchName] : []),
  ]);
  const completion: SyncCompletion = {
    checkout: {
      target: context.engine.trunk,
      original,
      shouldCheckout: removedOriginal,
    },
    expected: [...names].map((branchName) => ({
      branchName,
      head: progress.deleted.includes(branchName)
        ? ''
        : branchName === context.engine.trunk
        ? refresh.trunk?.head ?? refresh.trunkHead
        : 'branchName' in original &&
          branchName === original.branchName &&
          !cleanup.branches.some((entry) => entry.branchName === branchName)
        ? refresh.originalHead
        : getSha(`refs/heads/${branchName}`),
      metadata: progress.deleted.includes(branchName)
        ? ''
        : getSha(`refs/branch-metadata/${branchName}`),
    })),
    sources: [...(refresh.trunk ? [refresh.trunk] : []), ...refresh.nodes],
  };
  return completion;
}

/** Maintenance callers invoke only after validating their completed publication. */
export function recordSyncCompletionBranch(
  completion: SyncCompletion,
  branchName: string
): void {
  const expected = completion.expected.find(
    (entry) => entry.branchName === branchName
  );
  if (!expected) throw new Error(`Unexpected sync participant ${branchName}.`);
  expected.head = getSha(`refs/heads/${branchName}`);
  expected.metadata = getSha(`refs/branch-metadata/${branchName}`);
}

export function assertSyncCompletionGraph(completion: SyncCompletion): void {
  for (const expected of completion.expected)
    if (
      getSha(`refs/heads/${expected.branchName}`) !== expected.head ||
      !sameMetadataExceptFrozen(
        getSha(`refs/branch-metadata/${expected.branchName}`),
        expected.metadata
      )
    )
      throw new Error(
        `${expected.branchName} changed outside the completed sync plan.`
      );
  for (const name of Object.keys(getMetadataRefList()))
    if (!completion.expected.some((entry) => entry.branchName === name))
      throw new Error(
        `Unexpected tracked branch ${name} appeared during sync.`
      );
}

/** Initial sync and owned continuation share this checked completion boundary. */
export function finishSyncCompletion(
  completion: SyncCompletion,
  progress: {
    readonly updated: readonly string[];
    readonly deleted: readonly string[];
    readonly changedParents?: readonly string[];
    readonly releaseSources: () => void;
  },
  context: TContext
): void {
  try {
    assertSyncCompletionGraph(completion);
    finishGetCheckout(completion.checkout, progress.updated, 'sync');
    assertSyncCompletionGraph(completion);
    assertGetCheckout(completion.checkout);
    for (const source of completion.sources)
      if (getSha(source.sourceRef) !== source.head)
        throw new Error(`Pinned sync source ${source.sourceRef} changed.`);
    progress.releaseSources();
    assertSyncCompletionGraph(completion);
    assertGetCheckout(completion.checkout);
    if (
      completion.checkout.shouldCheckout &&
      'branchName' in completion.checkout.original
    )
      context.splog.info(
        `Original checkout ${completion.checkout.original.branchName} was deleted by sync cleanup; switched to trunk ${completion.checkout.target}.`
      );
  } catch (error) {
    throw new ExitFailedError(
      `Sync completion failed. Updated: ${
        progress.updated.join(', ') || 'none'
      }. Confirmed cleanup deletions: ${
        progress.deleted.join(', ') || 'none'
      }. Completed parent changes: ${
        progress.changedParents?.join(', ') || 'none'
      }.\nActual checkout: ${
        getCurrentBranchName() ?? 'detached HEAD'
      } (${getSha('HEAD')}).\n${
        error instanceof Error ? error.message : String(error)
      }\nManual inspection is required; reached work and concurrent changes are retained. Some owned source refs may already have been removed; inspect remaining source refs before retrying.`
    );
  }
}
