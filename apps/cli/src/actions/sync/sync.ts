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
    for (const { branch, formerParent } of entries) {
      if (refresh.reconciliation?.some((plan) => plan.branch === branch))
        continue;
      context.splog.info(
        `Deferred ${branch}. Keeping ${formerParent} for recovery. Dependent updates and cleanup are deferred.`
      );
    }
    applying = true;
    await executeSyncOperation(operation, context);
  } finally {
    if (!applying) releaseSyncRefresh(refresh);
  }
}
