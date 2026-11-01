import { clearContinuation } from '../persist_continuation';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import {
  planSyncMaintenance,
  applySyncMaintenance,
  assertSyncMaintenanceAvailable,
} from './sync_maintenance';
import {
  planSyncCleanup,
  applySyncCleanup,
  SyncCleanupProgress,
  assertSyncCleanupSnapshot,
} from './clean_branches';
import {
  prepareSyncRefresh,
  applySyncRefresh,
  releaseSyncRefresh,
} from './sync_refresh';

export async function syncAction(
  opts: {
    pull: boolean;
    force: boolean;
    delete: boolean;
    deleteAll: boolean;
    showDeleteProgress: boolean;
    restack: boolean;
  },
  context: TContext
): Promise<void> {
  uncommittedTrackedChangesPrecondition();
  const refresh = await prepareSyncRefresh(opts, context);
  try {
    const cleanup = await planSyncCleanup(opts, refresh, context);
    const maintenance = planSyncMaintenance(cleanup, context);
    if (opts.restack) assertSyncMaintenanceAvailable(maintenance, context);
    assertSyncCleanupSnapshot(cleanup);
    const updated = await applySyncRefresh(refresh, context);
    const progress: SyncCleanupProgress = {
      changed: [],
      deleted: [],
      incomplete: [],
    };
    try {
      applySyncCleanup(cleanup, context, progress);
    } catch (error) {
      throw new ExitFailedError(
        `Updated ${
          updated.join(', ') || 'none'
        } before sync cleanup stopped.\n${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (opts.restack && cleanup.replay.length) {
      context.continueConfig.update((data) => {
        data.delete = {
          branch: 'Cleanup candidates',
          mandatory: [...cleanup.replay],
        };
        data.branchesToRestack = maintenance.map((entry) => entry.branchName);
        data.branchesToSync = [];
      });
    }
    applySyncMaintenance(
      maintenance,
      {
        shouldRestack: opts.restack,
        updatedBranches: updated,
      },
      context
    );
    if (opts.restack && cleanup.replay.length) clearContinuation(context);
  } finally {
    releaseSyncRefresh(refresh);
  }
}
