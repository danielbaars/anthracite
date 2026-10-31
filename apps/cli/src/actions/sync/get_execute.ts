import { TContext } from '../../lib/context';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { getSha } from '../../lib/git/get_sha';
import { runGitCommand } from '../../lib/git/runner';
import { RebaseConflictError } from '../../lib/errors';
import { persistContinuation } from '../persist_continuation';
import { printConflictStatus } from '../print_conflict_status';
import { getBranchesFromRemote, GetImportDecision } from './get';
import { GetOperation } from './get_operation';
import { GetCheckoutIntent, finishGetCheckout } from './get_checkout';
import { GetMaintenanceEntry, applyGetMaintenance } from './get_maintenance';
import { RemoteUpdateNode } from './remote_update_graph';
import { RemoteTrunkUpdate, applyRemoteTrunk } from './remote_update_trunk';
import {
  getRecoveryIdentity,
  recordGetRecoveryWrite,
  saveGetOperation,
  validateGetRecovery,
  finishGetRecovery,
  reportGetFailure,
} from './get_recovery';

export function createGetOperation(
  args: {
    nodes: RemoteUpdateNode[];
    trunk: RemoteTrunkUpdate;
    maintenance: GetMaintenanceEntry[];
    imports: GetImportDecision[];
    checkout: GetCheckoutIntent;
    force: boolean;
    shouldRestack: boolean;
  },
  context: TContext
): GetOperation {
  const names = [
    ...new Set([
      args.trunk.branchName,
      ...args.nodes.map((node) => node.branchName),
      ...args.maintenance.flatMap((entry) => [
        entry.branchName,
        entry.parentBranchName,
      ]),
    ]),
  ];
  return {
    ...args,
    ...getRecoveryIdentity(),
    version: 1,
    repository: githubRepoSlug(context),
    remote: context.repoConfig.getRemote(),
    remoteUrl: runGitCommand({
      args: ['remote', 'get-url', context.repoConfig.getRemote()],
      onError: 'throw',
      resource: 'getRemoteIdentity',
    }),
    phase: 'trunk',
    trunkCompleted: false,
    completedRemote: [],
    completedMaintenance: [],
    updated: [],
    expected: names.map((branchName) => ({
      branchName,
      head: getSha(`refs/heads/${branchName}`),
      metadata: getSha(`refs/branch-metadata/${branchName}`),
    })),
  };
}

function completeGetBranch(
  operation: GetOperation,
  branch: string,
  context: TContext
): void {
  const previous = operation.expected.find(
    (item) => item.branchName === branch
  );
  if (
    previous &&
    (previous.head !== getSha(`refs/heads/${branch}`) ||
      previous.metadata !== getSha(`refs/branch-metadata/${branch}`))
  )
    if (!operation.updated.includes(branch)) operation.updated.push(branch);
  const completed =
    operation.phase === 'remote'
      ? operation.completedRemote
      : operation.completedMaintenance;
  if (!completed.includes(branch)) completed.push(branch);
  operation.active = undefined;
  saveGetOperation(operation, context, branch);
}

/** Initial get and fresh-process continuation execute the same saved bounded phases. */
export async function executeGetOperation(
  operation: GetOperation,
  context: TContext
): Promise<void> {
  saveGetOperation(operation, context);
  try {
    if (!operation.trunkCompleted) {
      applyRemoteTrunk(operation.trunk, context);
      operation.trunkCompleted = true;
      if (operation.trunk.head !== operation.trunk.previousHead)
        operation.updated.push(operation.trunk.branchName);
      saveGetOperation(operation, context, operation.trunk.branchName);
    }
    operation.phase = 'remote';
    saveGetOperation(operation, context);
    const nodes = operation.nodes.filter(
      (node) => !operation.completedRemote.includes(node.branchName)
    );
    await getBranchesFromRemote(
      {
        downstack: nodes.map((node) => node.branchName),
        base: operation.trunk.branchName,
        nodes,
        force: operation.force,
        importDecisions: operation.imports,
        onComplete: (branch) => completeGetBranch(operation, branch, context),
      },
      context
    );
    operation.phase = 'maintenance';
    operation.maintenance = operation.maintenance.map((entry) => ({
      ...entry,
      head: entry.head ?? context.engine.getRevision(entry.branchName),
    }));
    saveGetOperation(operation, context);
    applyGetMaintenance(
      operation.maintenance.filter(
        (entry) => !operation.completedMaintenance.includes(entry.branchName)
      ),
      {
        shouldRestack: operation.shouldRestack,
        updatedBranches: operation.updated,
        onComplete: (branch) => completeGetBranch(operation, branch, context),
      },
      context
    );
    operation.phase = 'checkout';
    saveGetOperation(operation, context);
    finishGetCheckout(operation.checkout, operation.updated);
    finishGetRecovery(operation, context);
  } catch (error) {
    reportGetFailure(operation, error);
  }
}

export async function continueGetOperation(
  opts: { addAll: boolean },
  context: TContext
): Promise<void> {
  const operation = validateGetRecovery(context.continueConfig.data);
  recordGetRecoveryWrite(context);
  const active = operation.active;
  if (!active) throw new Error('Validated get has no active rebase.');
  try {
    if (opts.addAll) context.engine.addAll();
    const participants = operation.shouldRestack
      ? operation.maintenance
          .filter(
            (entry) =>
              !entry.frozen &&
              !operation.completedMaintenance.includes(entry.branchName)
          )
          .map((entry) => entry.branchName)
      : [];
    const result = context.engine.continueRebase(
      active.base,
      participants,
      true
    );
    if (result.result === 'REBASE_CONFLICT') {
      persistContinuation(
        {
          rebasedBranchBase: active.base,
          branchesToSync: context.continueConfig.data.branchesToSync,
          branchesToRestack: context.continueConfig.data.branchesToRestack,
        },
        context
      );
      printConflictStatus('Rebase conflict is not yet resolved.', context);
      throw new RebaseConflictError();
    }
    completeGetBranch(operation, result.branchName, context);
  } catch (error) {
    reportGetFailure(operation, error);
  }
  await executeGetOperation(operation, context);
}
