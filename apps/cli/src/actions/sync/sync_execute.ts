import { inspectLocalReplay } from '../../lib/git/landing_replay';
import {
  finishSyncReconciliation,
  isPendingSyncReconciliation,
  readSyncReconciliation,
} from '../../lib/engine/sync_reconciliation';
import { readMetadataRef } from '../../lib/engine/metadata_ref';
import { hasCanonicalAncestry } from './local_restack';
import {
  assertSyncReconciliationFiles,
  assertSyncReconciliationLocalInputs,
  assertSyncReconciliationSource,
  ownedSyncReconciliation,
  reconciliationReplayRange,
  SyncReconciliationReplay,
} from './sync_reconciliation_replay';
import { continueConfigFactory } from '../../lib/spiffy/continuation_spf';
import { sameMetadataExceptFrozen } from '../../lib/engine/metadata_comparison';
import { TContext } from '../../lib/context';
import { getSyncRemoteUrl, getSyncRepository } from './sync_identity';
import { getSha } from '../../lib/git/get_sha';
import { getCurrentBranchName } from '../../lib/git/branch_ops';
import { runGitCommand } from '../../lib/git/runner';
import { persistContinuation } from '../persist_continuation';
import { SyncOperation, syncOperationSchema } from './sync_operation';
import { getRecoveryIdentity } from './get_recovery';
import { SyncRefreshPlan, getSyncPullRequestInfo } from './sync_refresh';
import {
  SyncCleanupPlan,
  applySyncCleanup,
  verifySyncCleanupPrCoverage,
} from './clean_branches';
import { GetMaintenanceEntry } from './get_maintenance';
import { applySyncMaintenance } from './sync_maintenance';
import {
  createSyncCompletion,
  finishSyncCompletion,
  recordSyncCompletionBranch,
} from './sync_completion';
import { applyRemoteTrunk } from './remote_update_trunk';
import { getBranchesFromRemote } from './get';
import { lookupPullRequest } from './remote_update_graph';
import {
  assertSyncExpected,
  assertSyncSources,
  getPendingSyncMandatory,
} from './sync_recovery_guards';
import {
  assertSyncRecoveryWrite,
  recordSyncRecoveryWrite,
  saveSyncOperation,
  validateSyncRecovery,
  refuseSync,
} from './sync_recovery';

export function createSyncOperation(
  {
    refresh,
    cleanup,
    maintenance,
  }: {
    refresh: SyncRefreshPlan;
    cleanup: SyncCleanupPlan;
    maintenance: GetMaintenanceEntry[];
  },
  context: TContext
): SyncOperation {
  const names = new Set([
    context.engine.trunk,
    ...cleanup.branches.map((entry) => entry.branchName),
    ...cleanup.untouched.map((entry) => entry.branchName),
    ...('branchName' in refresh.original ? [refresh.original.branchName] : []),
  ]);
  return syncOperationSchema.parse({
    kind: 'sync',
    version: 1,
    ...getRecoveryIdentity(),
    repository: getSyncRepository(context.repoConfig),
    remote: context.repoConfig.getRemote(),
    remoteUrl: getSyncRemoteUrl(context.repoConfig.getRemote()),
    trunkName: context.engine.trunk,
    refresh,
    cleanup,
    maintenance,
    phase: 'trunk',
    trunkCompleted: false,
    completedRemote: [],
    completedPrs: [],
    completedMaintenance: [],
    cleanupCompleted: false,
    progress: { changed: [], deleted: [], incomplete: [] },
    updated: [],
    expected: [...names].map((branchName) => ({
      branchName,
      head: getSha(`refs/heads/${branchName}`),
      metadata: getSha(`refs/branch-metadata/${branchName}`),
    })),
  });
}
function completeSyncBranch(
  operation: SyncOperation,
  branch: string,
  context: TContext
): void {
  const expected = operation.expected.find(
    (entry) => entry.branchName === branch
  );
  if (
    expected?.head !== getSha(`refs/heads/${branch}`) &&
    !operation.updated.includes(branch)
  )
    operation.updated.push(branch);
  const completed =
    operation.phase === 'remote'
      ? operation.completedRemote
      : operation.completedMaintenance;
  if (!completed.includes(branch)) completed.push(branch);
  operation.active = undefined;
  if (operation.completion)
    recordSyncCompletionBranch(operation.completion, branch);
  saveSyncOperation(operation, context, branch);
}

/** Execute only the original pinned selections and choices, including after a conflict. */
export async function executeSyncOperation(
  operation: SyncOperation,
  context: TContext
): Promise<void> {
  saveSyncOperation(operation, context);
  try {
    assertSyncExpected(operation);
    assertSyncSources(operation);
    if (!operation.trunkCompleted) {
      if (operation.refresh.trunk)
        applyRemoteTrunk(operation.refresh.trunk, context);
      operation.trunkCompleted = true;
      if (
        operation.refresh.trunk &&
        operation.refresh.trunk.head !== operation.refresh.trunk.previousHead
      )
        operation.updated.push(operation.trunkName);
      saveSyncOperation(operation, context, operation.trunkName);
    }
    if (!operation.cleanupCompleted) {
      await executeSyncRefresh(operation, context);
      executeSyncCleanup(operation, context);
    }
    operation.phase = 'maintenance';
    saveSyncOperation(operation, context);
    assertSyncExpected(operation);
    applySyncMaintenance(
      operation.maintenance.filter(
        (entry) => !operation.completedMaintenance.includes(entry.branchName)
      ),
      {
        shouldRestack: operation.cleanup.restack,
        updatedBranches: operation.updated,
        onComplete: (branch) => completeSyncBranch(operation, branch, context),
      },
      context
    );
    await executeSyncReconciliation(operation, context);
    finishOwnedSync(operation, context);
  } catch (error) {
    reportSyncFailure(operation, error);
  }
}

async function executeSyncRefresh(
  operation: SyncOperation,
  context: TContext
): Promise<void> {
  operation.phase = 'remote';
  saveSyncOperation(operation, context);
  const nodes = operation.refresh.nodes.filter(
    (node) => !operation.completedRemote.includes(node.branchName)
  );
  await getBranchesFromRemote(
    {
      downstack: nodes.map((node) => node.branchName),
      base: operation.trunkName,
      nodes,
      force: false,
      scope: 'sync',
      preserved: operation.refresh.preserved,
      onComplete: (branch) => completeSyncBranch(operation, branch, context),
    },
    context
  );
  operation.phase = 'prs';
  saveSyncOperation(operation, context);
  for (const pr of operation.refresh.prs.filter(
    (entry) => !operation.completedPrs.includes(entry.headRefName)
  )) {
    assertSyncExpected(operation);
    const expected = operation.expected.find(
      (entry) => entry.branchName === pr.headRefName
    );
    const metadata = context.engine.upsertPrInfo(
      pr.headRefName,
      getSyncPullRequestInfo(pr)
    );
    if (
      !expected ||
      !metadata ||
      getSha(`refs/heads/${pr.headRefName}`) !== expected.head ||
      !sameMetadataExceptFrozen(
        getSha(`refs/branch-metadata/${pr.headRefName}`),
        metadata
      )
    )
      refuseSync(
        `${pr.headRefName} PR publication changed; reached work and concurrent state require manual inspection.`
      );
    operation.completedPrs.push(pr.headRefName);
    saveSyncOperation(operation, context, pr.headRefName);
  }
}

function executeSyncCleanup(operation: SyncOperation, context: TContext): void {
  operation.phase = 'cleanup';
  saveSyncOperation(operation, context);
  assertSyncExpected(operation);
  const cleanup = verifySyncCleanupPrCoverage(
    operation.cleanup,
    context,
    operation.cleanup.deletions
  );
  assertSyncExpected(operation);
  applySyncCleanup(cleanup, context, {
    progress: operation.progress,
    onProgress: (branch, boundary) => {
      const expected = operation.expected.find(
        (entry) => entry.branchName === branch
      );
      if (!expected) refuseSync(`Unexpected cleanup participant ${branch}.`);
      if (boundary === 'deleted') expected.head = '';
      if (boundary === 'metadata') expected.metadata = '';
      saveSyncOperation(
        operation,
        context,
        boundary === 'parent' ? branch : undefined
      );
      if (boundary !== 'incomplete') assertSyncExpected(operation);
    },
  });
  operation.cleanupCompleted = true;
  const completion = createSyncCompletion(
    {
      refresh: operation.refresh,
      cleanup: operation.cleanup,
      progress: operation.progress,
    },
    context
  );
  operation.completion = {
    ...completion,
    untouched: [...completion.untouched],
    sources: completion.sources.map(({ sourceRef, head }) => ({
      sourceRef,
      head,
    })),
  };
  operation.maintenance = operation.maintenance.map((entry) => ({
    ...entry,
    head: getSha(`refs/heads/${entry.branchName}`),
  }));
}

async function executeSyncReconciliation(
  operation: SyncOperation,
  context: TContext
): Promise<void> {
  for (const plan of operation.refresh.reconciliation ?? []) {
    if (operation.completedMaintenance.includes(plan.branch)) continue;
    assertSyncExpected(operation);
    try {
      // Hooks, configuration and the source worktree may have changed since selection.
      const assessment = await inspectLocalReplay(
        reconciliationReplayRange(plan)
      );
      if (assessment.status !== 'clean')
        throw new Error('The replay is no longer verified conflict-free.');
      await assertSyncReconciliationSource(plan, context);
      assertSyncExpected(operation);
      assertSyncReconciliationLocalInputs(plan, operation);
      assertSyncReconciliationFiles(plan);
    } catch {
      context.splog.info(
        `Reconciliation for ${plan.branch} could not be reverified. Keeping local work and deferring cleanup.`
      );
      continue;
    }
    operation.reconciling = plan.branch;
    saveSyncOperation(operation, context);
    const range = reconciliationReplayRange(plan);
    if (plan.replacement) {
      context.engine.applySyncReplacement(plan);
      assertSyncExpected(operation, plan.branch);
      saveSyncOperation(operation, context, plan.branch);
      assertSyncReconciliationLocalInputs(plan, operation);
      assertSyncReconciliationFiles(plan);
    }
    const result = context.engine.reconcileSyncBranch(
      { ...range, metadata: plan.metadata },
      false
    );
    if (result.result === 'REBASE_CONFLICT') {
      persistContinuation({ rebasedBranchBase: plan.onto }, context);
      throw new Error(
        `Replaying ${plan.replacement ? 'GitHub' : 'local'} commits on ${
          plan.branch
        } hit a conflict.`
      );
    }
    completeSyncReconciliation(
      { plan, publication: result },
      operation,
      context
    );
  }
}

function completeSyncReconciliation(
  {
    plan,
    publication: { head, metadata },
  }: {
    readonly plan: SyncReconciliationReplay;
    readonly publication: { readonly head: string; readonly metadata: string };
  },
  operation: SyncOperation,
  context: TContext
): void {
  const parent = readMetadataRef(plan.branch);
  if (
    parent.parentBranchName !== operation.trunkName ||
    parent.parentBranchRevision !== plan.onto ||
    getSha(`refs/heads/${operation.trunkName}`) !== plan.onto ||
    !hasCanonicalAncestry(plan.onto, head)
  )
    refuseSync(
      `The reached head or tracking for ${plan.branch} could not be verified.`
    );
  assertSyncRecoveryWrite(context);
  finishSyncReconciliation(
    {
      branch: plan.branch,
      head: plan.head,
      base: plan.from,
      metadata: plan.metadata,
    },
    { head, metadata, trunk: operation.trunkName, onto: plan.onto }
  );
  operation.reconciling = undefined;
  if (operation.completion)
    operation.completion.untouched = operation.completion.untouched.filter(
      (name) => name !== plan.branch
    );
  completeSyncBranch(operation, plan.branch, context);
  context.splog.info(
    `Reconciled ${plan.branch} on ${operation.trunkName}, keeping local commits. No changes published.`
  );
}

function finishOwnedSync(operation: SyncOperation, context: TContext): void {
  operation.phase = 'checkout';
  saveSyncOperation(operation, context);
  if (!operation.completion) throw new Error('Sync completion is missing.');
  finishSyncCompletion(
    operation.completion,
    {
      updated: operation.updated,
      deleted: operation.progress.deleted,
      changedParents: operation.progress.changed,
      assertOwnership: () => assertSyncRecoveryWrite(context),
      releaseSources: () => {
        for (const source of operation.completion?.sources ?? []) {
          assertSyncRecoveryWrite(context);
          runGitCommand({
            args: ['update-ref', '-d', source.sourceRef, source.head],
            onError: 'throw',
            resource: 'releaseSyncSource',
          });
        }
      },
    },
    context
  );
  assertSyncRecoveryWrite(context);
  if (context.continueConfig.data.sync !== operation)
    refuseSync('Sync recovery owner changed.');
  context.continueConfig.delete();
  const remaining = readSyncReconciliation().entries;
  const resolved =
    operation.refresh.reconciliation?.filter(({ branch }) =>
      operation.completedMaintenance.includes(branch)
    ) ?? [];
  const deferred =
    operation.refresh.deferred?.filter(
      (name) =>
        isPendingSyncReconciliation(name, remaining) ||
        !resolved.some(
          ({ branch, formerParent }) => name === branch || name === formerParent
        )
    ) ?? [];
  if (deferred.length)
    context.splog.info(
      `Sync partially completed. Updated: ${
        operation.updated.join(', ') || 'none'
      }. Deferred: ${deferred.join(', ')}.`
    );
}

export async function continueSyncOperation(
  opts: { addAll: boolean },
  context: TContext
): Promise<void> {
  const operation = validateSyncRecovery(context.continueConfig.data);
  recordSyncRecoveryWrite(context);
  const active = operation.active;
  if (!active) throw new Error('Validated sync has no active rebase.');
  try {
    verifyPendingSyncCleanup(operation, context);
    assertSyncRecoveryWrite(context);
    validateSyncRecovery(context.continueConfig.data);
    const reconciliation = ownedSyncReconciliation(
      operation,
      active.branchName
    );
    if (reconciliation) {
      if (
        active.onto !== reconciliation.onto ||
        active.base !== reconciliation.onto ||
        active.originalHead !== reconciliationReplayRange(reconciliation).head
      )
        refuseSync('Saved reconciliation does not match the owned rebase.');
      await assertSyncReconciliationSource(reconciliation, context);
      assertSyncRecoveryWrite(context);
      validateSyncRecovery(context.continueConfig.data);
      if (opts.addAll) context.engine.addAll();
      const result = context.engine.reconcileSyncBranch(
        {
          ...reconciliationReplayRange(reconciliation),
          metadata: reconciliation.metadata,
        },
        true
      );
      if (result.result === 'REBASE_CONFLICT') {
        validateSyncRecovery(context.continueConfig.data);
        persistContinuation({ rebasedBranchBase: active.base }, context);
        throw new Error('Rebase conflict is not yet resolved.');
      }
      completeSyncReconciliation(
        { plan: reconciliation, publication: result },
        operation,
        context
      );
    } else
      await continueOrdinarySyncRebase({ ...opts, active }, operation, context);
    verifyPendingSyncCleanup(operation, context);
  } catch (error) {
    reportSyncFailure(operation, error);
  }
  await executeSyncOperation(operation, context);
}

async function continueOrdinarySyncRebase(
  {
    addAll,
    active,
  }: {
    readonly addAll: boolean;
    readonly active: NonNullable<SyncOperation['active']>;
  },
  operation: SyncOperation,
  context: TContext
): Promise<void> {
  if (addAll) context.engine.addAll();
  const participants = [
    ...new Set([
      ...getPendingSyncMandatory(operation),
      ...(operation.cleanup.restack
        ? operation.maintenance
            .filter(
              (entry) =>
                !entry.frozen &&
                !operation.completedMaintenance.includes(entry.branchName)
            )
            .map((entry) => entry.branchName)
        : []),
    ]),
  ];
  const result = context.engine.continueRebase(active.base, participants, true);
  if (result.result === 'REBASE_CONFLICT') {
    validateSyncRecovery(context.continueConfig.data);
    persistContinuation(
      {
        rebasedBranchBase: active.base,
        branchesToSync: context.continueConfig.data.branchesToSync,
        branchesToRestack: context.continueConfig.data.branchesToRestack,
      },
      context
    );
    throw new Error('Rebase conflict is not yet resolved.');
  }
  completeSyncBranch(operation, result.branchName, context);
}
function verifyPendingSyncCleanup(
  operation: SyncOperation,
  context: TContext
): void {
  if (operation.cleanupCompleted) return;
  const pending = operation.cleanup.deletions.filter(
    (name) => !operation.progress.deleted.includes(name)
  );
  verifySyncCleanupPrCoverage(operation.cleanup, context, pending);
  assertSyncExpected(operation);
  for (const branch of operation.cleanup.branches.filter(
    (entry) =>
      pending.includes(entry.branchName) &&
      (entry.state === 'CLOSED' || entry.state === 'MERGED')
  )) {
    if (!context.repoConfig.getIsGithubIntegrationEnabled())
      refuseSync(
        'Pending PR-based sync cleanup requires GitHub read access; integration is disabled. Cached PR state is not fresh.'
      );
    if (!branch.prNumber)
      refuseSync(`Missing saved cleanup identity for ${branch.branchName}.`);
    const pr = lookupPullRequest(String(branch.prNumber), context, 'sync');
    if (
      !pr ||
      pr.headRefName !== branch.branchName ||
      pr.number !== branch.prNumber ||
      pr.url !== branch.prInfo?.url ||
      pr.state !== branch.state ||
      pr.baseRefName !== branch.prInfo?.base ||
      (operation.refresh.prs.some(
        (entry) => entry.headRefName === branch.branchName
      ) &&
        pr.headRefOid !==
          operation.refresh.prs.find(
            (entry) => entry.headRefName === branch.branchName
          )?.headRefOid)
    )
      refuseSync(
        `Pending cleanup PR identity/state changed for ${branch.branchName}; replan before deletion.`
      );
  }
  assertSyncExpected(operation);
}
function reportSyncFailure(operation: SyncOperation, error: unknown): never {
  let live = false;
  try {
    live = validateSyncRecovery(requireSavedSync(), false).kind === 'sync';
  } catch {
    /* Preserve unverified recovery for manual inspection. */
  }
  refuseSync(
    `Sync stopped during ${operation.phase}. Updated: ${
      operation.updated.join(', ') || 'none'
    }. Completed feature refresh: ${
      operation.completedRemote.join(', ') || 'none'
    }. Pending feature refresh: ${
      operation.refresh.nodes
        .filter((node) => !operation.completedRemote.includes(node.branchName))
        .map((node) => node.branchName)
        .join(', ') || 'none'
    }. Confirmed cleanup deletions: ${
      operation.progress.deleted.join(', ') || 'none'
    }. Completed parent changes: ${
      operation.progress.changed.join(', ') || 'none'
    }. Completed local maintenance: ${
      operation.completedMaintenance.join(', ') || 'none'
    }. Pending local maintenance: ${
      operation.maintenance
        .filter(
          (entry) => !operation.completedMaintenance.includes(entry.branchName)
        )
        .map((entry) => entry.branchName)
        .join(', ') || 'none'
    }. Actual checkout: ${getCurrentBranchName() ?? 'detached HEAD'} (${getSha(
      'HEAD'
    )}). Original project: ${operation.root}. ${
      live
        ? 'Resolve the conflict and run an continue.'
        : 'No verified owned continuation; inspect reached work and saved sync intent manually. A supported owned sync can be ended with an sync --abort, preserving reached work and residual Git/files.'
    } Some source refs may already have been removed; inspect remaining refs.\n${
      error instanceof Error ? error.message : String(error)
    }`
  );
}
function requireSavedSync() {
  return continueConfigFactory.load(undefined, { preserveInvalid: true }).data;
}
