import { createSyncOperation, executeSyncOperation } from './sync_execute';
import { TContext } from '../../lib/context';
import { retainSyncReconciliation } from '../../lib/engine/sync_reconciliation';
import { assertRemoteTrunkUnchanged } from './remote_update_trunk';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import {
  planSyncMaintenance,
  assertSyncMaintenanceAvailable,
} from './sync_maintenance';
import { planSyncCleanup, assertSyncCleanupSnapshot } from './clean_branches';
import { prepareSyncRefresh, releaseSyncRefresh } from './sync_refresh';

export async function syncAction(
  opts: {
    pull: boolean;
    force: boolean;
    delete: boolean;
    deleteAll: boolean;
    showDeleteProgress: boolean;
    restack: boolean;
    debug?: boolean;
  },
  context: TContext
): Promise<void> {
  uncommittedTrackedChangesPrecondition();
  const { refresh, saved, entries } = await prepareSyncRefresh(opts, context);
  let applying = false;
  try {
    const cleanup = await planSyncCleanup(opts, refresh, context);
    const maintenance = planSyncMaintenance(cleanup, context);
    if (opts.restack) assertSyncMaintenanceAvailable(maintenance, context);
    assertSyncCleanupSnapshot(cleanup);
    const operation = createSyncOperation(
      { refresh, cleanup, maintenance },
      context
    );
    if (refresh.trunk && entries.length)
      assertRemoteTrunkUnchanged(refresh.trunk);
    retainSyncReconciliation(saved, entries);
    applying = true;
    await executeSyncOperation(operation, context);
  } finally {
    if (!applying) releaseSyncRefresh(refresh);
  }
}
