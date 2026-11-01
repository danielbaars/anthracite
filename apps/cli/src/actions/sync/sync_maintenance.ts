import { getSha } from '../../lib/git/get_sha';
import { TContext } from '../../lib/context';
import { SyncCleanupPlan } from './clean_branches';
import {
  GetMaintenanceEntry,
  applyGetMaintenance,
  assertGetMaintenanceAvailable,
} from './get_maintenance';

/** Sync maintains every surviving tracked stack, including unpublished stale roots. */
export function planSyncMaintenance(
  cleanup: SyncCleanupPlan,
  context: TContext
): GetMaintenanceEntry[] {
  const branches = new Map(
    cleanup.branches
      .filter((entry) => !cleanup.accepted.includes(entry.branchName))
      .map((entry) => [entry.branchName, entry])
  );
  const parents = new Map(
    cleanup.parents.map((entry) => [entry.branchName, entry.parent])
  );
  const ordered: string[] = [];
  const visit = (name: string): void => {
    if (ordered.includes(name)) return;
    const entry = branches.get(name);
    if (!entry) return;
    const parent = parents.get(name) ?? entry.parent;
    if (branches.has(parent)) visit(parent);
    ordered.push(name);
  };
  [...branches.keys()].sort().forEach(visit);
  const replayed = new Set<string>();
  const plan: GetMaintenanceEntry[] = [];
  for (const name of ordered) {
    const branch = branches.get(name);
    if (!branch) continue;
    const parentBranchName = parents.get(name) ?? branch.parent;
    const parentHead =
      parentBranchName === context.engine.trunk
        ? cleanup.trunkHead
        : branches.get(parentBranchName)?.head;
    if (branch.base === parentHead && !replayed.has(parentBranchName)) continue;
    plan.push({
      branchName: name,
      parentBranchName,
      head: branch.head,
      base: branch.base,
      frozen: branch.frozen,
    });
    if (!branch.frozen) replayed.add(name);
  }
  return plan;
}

export type SyncMaintenanceProgress = {
  readonly completed: string[];
  readonly expected: {
    readonly branchName: string;
    readonly head: string;
    readonly metadata: string;
  }[];
};

export const assertSyncMaintenanceAvailable = assertGetMaintenanceAvailable;

export function applySyncMaintenance(
  plan: readonly GetMaintenanceEntry[],
  options: Parameters<typeof applyGetMaintenance>[1] & {
    readonly progress?: SyncMaintenanceProgress;
  },
  context: TContext
): string[] {
  return applyGetMaintenance(
    plan,
    {
      ...options,
      operation: 'sync',
      onComplete: (branchName) => {
        options.progress?.completed.push(branchName);
        options.progress?.expected.push({
          branchName,
          head: getSha(`refs/heads/${branchName}`),
          metadata: getSha(`refs/branch-metadata/${branchName}`),
        });
        options.onComplete?.(branchName);
      },
    },
    context
  );
}
