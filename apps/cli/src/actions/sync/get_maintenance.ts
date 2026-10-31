import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { ExitFailedError } from '../../lib/errors';
import { readMetadataRef } from '../../lib/engine/metadata_ref';
import { getCurrentBranchName } from '../../lib/git/branch_ops';
import { getSha } from '../../lib/git/get_sha';
import { TContext } from '../../lib/context';
import { restackBranches } from '../restack';
import { RemoteTrunkUpdate } from './remote_update_trunk';
import { GetImportDecision } from './get';
import { RemoteUpdateNode } from './remote_update_graph';

export type GetMaintenanceEntry = {
  readonly branchName: string;
  readonly parentBranchName: string;
  readonly head: string | undefined;
  readonly base: string;
  readonly frozen: boolean;
};

/** Incoming snapshots and local maintenance have separate, bounded selections. */
export function planGetMaintenance(
  args: {
    readonly nodes: readonly RemoteUpdateNode[];
    readonly trunk: RemoteTrunkUpdate;
    readonly importDecisions: readonly GetImportDecision[];
  },
  context: TContext
): GetMaintenanceEntry[] {
  const incoming = new Map(args.nodes.map((node) => [node.branchName, node]));
  const names = new Set([
    ...context.engine.allBranchNames.filter((name) =>
      context.engine.isBranchTracked(name)
    ),
    ...incoming.keys(),
  ]);
  const parentOf = (name: string): string =>
    incoming.get(name)?.parentBranchName ??
    context.engine.getParentPrecondition(name);
  const headOf = (name: string): string =>
    name === args.trunk.branchName
      ? args.trunk.head
      : incoming.get(name)?.head ?? context.engine.getRevision(name);
  const baseOf = (name: string): string => {
    const node = incoming.get(name);
    return node &&
      (node.previousHead !== node.head ||
        node.previousParentBranchName !== node.parentBranchName ||
        node.resolution === 'REBASE' ||
        node.resolution === 'OVERWRITE')
      ? node.base
      : context.engine.getBaseRevision(name);
  };
  const scope = new Set(incoming.keys());
  const affected = new Set<string>();
  for (const name of scope) {
    const node = incoming.get(name);
    if (
      affected.has(name) ||
      (node &&
        (node.previousHead !== node.head ||
          node.previousParentBranchName !== node.parentBranchName ||
          node.resolution === 'REBASE' ||
          baseOf(name) !== headOf(parentOf(name))))
    ) {
      for (const child of names) {
        if (!context.engine.isTrunk(child) && parentOf(child) === name) {
          scope.add(child);
          affected.add(child);
        }
      }
    }
  }
  const ordered: string[] = [];
  const visit = (name: string): void => {
    if (ordered.includes(name)) return;
    const parent = parentOf(name);
    if (scope.has(parent)) visit(parent);
    ordered.push(name);
  };
  [...scope].sort().forEach(visit);
  const replayed = new Set(
    args.nodes
      .filter((node) => node.resolution === 'REBASE')
      .map((node) => node.branchName)
  );
  const plan: GetMaintenanceEntry[] = [];
  for (const name of ordered) {
    const node = incoming.get(name);
    const parentBranchName = parentOf(name);
    const base = baseOf(name);
    if (base === headOf(parentBranchName) && !replayed.has(parentBranchName))
      continue;
    const frozen =
      context.engine.branchExists(name) && context.engine.isBranchTracked(name)
        ? context.engine.isBranchFrozen(name)
        : args.importDecisions.find((decision) => decision.branchName === name)
            ?.frozen ?? true;
    plan.push({
      branchName: name,
      parentBranchName,
      head: node?.resolution === 'REBASE' ? undefined : headOf(name),
      base,
      frozen,
    });
    if (!frozen) replayed.add(name);
  }
  return plan;
}

export function assertGetMaintenanceAvailable(
  plan: readonly GetMaintenanceEntry[],
  context: TContext
): void {
  const editable = plan.filter((entry) => !entry.frozen);
  if (editable.length === 0) return;
  uncommittedTrackedChangesPrecondition();
  assertBranchesAvailableInWorktrees(editable.map((entry) => entry.branchName));
  assertRestackFilesAvailable({
    branches: editable
      .filter(
        (entry) =>
          context.engine.branchExists(entry.branchName) &&
          context.engine.isBranchTracked(entry.branchName)
      )
      .map((entry) => ({
        name: entry.branchName,
        from: context.engine.getBaseRevision(entry.branchName),
      })),
    operation: 'get',
  });
}

export function applyGetMaintenance(
  plan: readonly GetMaintenanceEntry[],
  {
    shouldRestack,
    updatedBranches,
  }: {
    readonly shouldRestack: boolean;
    readonly updatedBranches: readonly string[];
  },
  context: TContext
): string[] {
  if (plan.length === 0) return [];
  const names = plan.map((entry) => entry.branchName);
  context.splog.info(`Local maintenance: ${names.join(', ')}.`);
  if (!shouldRestack) {
    context.splog.info(`Pending restack: ${names.join(', ')} (--no-restack).`);
    return [];
  }
  const expectedHeads = new Map(
    plan.map((entry) => [
      entry.branchName,
      entry.head ?? context.engine.getRevision(entry.branchName),
    ])
  );
  const completed = new Set<string>();
  try {
    restackBranches([...names], context, {
      preserveOtherRefs: true,
      beforeBranch: () => {
        const pending = plan.filter(
          (entry) => !completed.has(entry.branchName)
        );
        assertGetMaintenanceUnchanged(pending, expectedHeads, context);
        assertGetMaintenanceAvailable(pending, context);
      },
      onComplete: (branch) => completed.add(branch),
    });
    const frozen = plan.filter((entry) =>
      context.engine.isBranchFrozen(entry.branchName)
    );
    if (frozen.length > 0)
      context.splog.info(
        `Unreplayed frozen work: ${frozen
          .map((entry) => entry.branchName)
          .join(', ')}.`
      );
    return plan
      .filter(
        (entry) =>
          getSha(`refs/heads/${entry.branchName}`) !==
            expectedHeads.get(entry.branchName) ||
          readMetadataRef(entry.branchName).parentBranchRevision !== entry.base
      )
      .map((entry) => entry.branchName);
  } catch (error) {
    throw new ExitFailedError(
      `Updated ${
        updatedBranches.join(', ') || 'none'
      } before get stopped during local maintenance.\nCompleted local maintenance: ${
        [...completed].join(', ') || 'none'
      }.\nPending local maintenance: ${
        names.filter((name) => !completed.has(name)).join(', ') || 'none'
      }.\nActual checkout: ${
        getCurrentBranchName() ?? 'detached HEAD'
      } (${getSha('HEAD')}).\n${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function assertGetMaintenanceUnchanged(
  plan: readonly GetMaintenanceEntry[],
  expectedHeads: ReadonlyMap<string, string>,
  context: TContext
): void {
  for (const entry of plan) {
    const metadata = readMetadataRef(entry.branchName);
    if (
      getSha(`refs/heads/${entry.branchName}`) !==
        expectedHeads.get(entry.branchName) ||
      metadata.parentBranchName !== entry.parentBranchName ||
      metadata.parentBranchRevision !== entry.base ||
      getSha(`refs/heads/${entry.parentBranchName}`) !==
        context.engine.getRevision(entry.parentBranchName)
    )
      throw new ExitFailedError(
        `${entry.branchName} changed while planning local maintenance. Inspect the reached updates before retrying.`
      );
  }
}
