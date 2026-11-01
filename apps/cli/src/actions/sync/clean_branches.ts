import chalk from 'chalk';
import { TContext } from '../../lib/context';
import {
  getMetadataRefList,
  readMetadataRef,
  TBranchPRInfo,
} from '../../lib/engine/metadata_ref';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertNoGitOperation } from '../../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { getSha } from '../../lib/git/get_sha';
import { isDiffEmpty } from '../../lib/git/diff';
import { isMerged } from '../../lib/git/is_merged';
import { ExitFailedError } from '../../lib/errors';
import { SyncRefreshPlan, getSyncPullRequestInfo } from './sync_refresh';

type CleanupBranch = {
  readonly branchName: string;
  readonly previousHead: string;
  readonly previousMetadata: string;
  readonly parent: string;
  readonly head?: string;
  readonly base: string;
  readonly frozen: boolean;
  readonly prNumber?: number;
  readonly prInfo?: TBranchPRInfo;
  readonly state?: string;
};
export type SyncCleanupPlan = {
  readonly branches: readonly CleanupBranch[];
  readonly trunkHead: string;
  readonly accepted: readonly string[];
  readonly deletions: readonly string[];
  readonly declined: readonly string[];
  readonly excluded: readonly string[];
  readonly parents: readonly { branchName: string; parent: string }[];
  readonly mandatory: readonly string[];
  readonly replay: readonly string[];
  readonly restack: boolean;
};
export type SyncCleanupProgress = {
  readonly changed: string[];
  readonly deleted: string[];
  readonly incomplete: string[];
};

/** Consent and mandatory closure use the graph after all pinned incoming updates. */
export async function planSyncCleanup(
  opts: {
    delete: boolean;
    force: boolean;
    deleteAll: boolean;
    restack: boolean;
    showDeleteProgress: boolean;
  },
  refresh: SyncRefreshPlan,
  context: TContext
): Promise<SyncCleanupPlan> {
  const branches = projectCleanupBranches(refresh, context);
  const trunk =
    refresh.trunk?.head ?? context.engine.getRevision(context.engine.trunk);
  const accepted: string[] = [];
  const declined: string[] = [];
  if (opts.delete)
    context.splog.info(
      '🧹 Checking if any branches have been merged/closed and can be deleted...'
    );
  for (const branch of opts.delete ? branches : []) {
    const reason = cleanupReason(branch, trunk, context.engine.trunk);
    if (!reason) continue;
    const confirmed =
      opts.force ||
      opts.deleteAll ||
      (context.interactive &&
        (
          await context.prompts({
            type: 'confirm',
            name: 'value',
            message: `${reason}. Delete it?`,
            initial: true,
          })
        ).value === true);
    (confirmed ? accepted : declined).push(branch.branchName);
  }
  const excluded: string[] = [];
  const projection = { trunkName: context.engine.trunk, trunkHead: trunk };
  // Removing one candidate can expose a frozen survivor to another candidate.
  while (excluded.length < accepted.length) {
    const blocked = accepted.filter(
      (name) =>
        !excluded.includes(name) &&
        cleanupClosure(
          branches,
          accepted.filter((candidate) => !excluded.includes(candidate)),
          { ...projection, root: name }
        ).mandatory.some(
          (survivor) =>
            branches.find((branch) => branch.branchName === survivor)?.frozen
        )
    );
    if (!blocked.length) break;
    for (const name of blocked) {
      const frozen = cleanupClosure(
        branches,
        accepted.filter((candidate) => !excluded.includes(candidate)),
        { ...projection, root: name }
      ).mandatory.filter(context.engine.isBranchFrozen);
      excluded.push(name);
      context.splog.info(
        `Skipping cleanup of ${name}: frozen mandatory survivors ${frozen.join(
          ', '
        )}. Unfreeze them before cleanup.`
      );
    }
  }
  const allowed = accepted.filter((name) => !excluded.includes(name));
  const closure = cleanupClosure(branches, allowed, projection);
  const plan = {
    branches,
    trunkHead: trunk,
    accepted: allowed,
    deletions: [...allowed].sort(
      (left, right) =>
        cleanupDepth(right, branches, allowed) -
        cleanupDepth(left, branches, allowed)
    ),
    declined,
    excluded,
    ...closure,
    restack: opts.restack,
  };
  assertSyncCleanupAvailable(plan, context);
  return plan;
}

function projectCleanupBranches(
  refresh: SyncRefreshPlan,
  context: TContext
): CleanupBranch[] {
  return context.engine.allBranchNames
    .filter((name) => context.engine.isBranchTracked(name))
    .sort()
    .map((branchName) => {
      const node = refresh.nodes.find(
        (entry) => entry.branchName === branchName
      );
      const freshPr = refresh.prs.find(
        (entry) => entry.headRefName === branchName
      );
      const pr = freshPr
        ? getSyncPullRequestInfo(freshPr)
        : context.engine.getPrInfo(branchName);
      const changed =
        node &&
        (node.previousHead !== node.head ||
          node.previousParentBranchName !== node.parentBranchName ||
          node.resolution === 'REBASE' ||
          node.resolution === 'OVERWRITE');
      return {
        branchName,
        previousHead: context.engine.getRevision(branchName),
        previousMetadata: getSha(`refs/branch-metadata/${branchName}`),
        parent:
          node?.parentBranchName ??
          context.engine.getParentPrecondition(branchName),
        head:
          node?.resolution === 'REBASE'
            ? undefined
            : node?.head ?? context.engine.getRevision(branchName),
        base:
          changed && node
            ? node.base
            : context.engine.getBaseRevision(branchName),
        frozen: context.engine.isBranchFrozen(branchName),
        prNumber: pr?.number,
        prInfo: pr,
        state: pr?.state,
      };
    });
}

function cleanupReason(
  branch: CleanupBranch,
  trunk: string,
  trunkName: string
): string | undefined {
  if (branch.head && isDiffEmpty(branch.head, branch.base) && !branch.prNumber)
    return undefined;
  if (branch.state === 'CLOSED' || branch.state === 'MERGED')
    return `${branch.branchName} is ${branch.state.toLowerCase()} on GitHub`;
  // A reconciliation rebase has no known result yet; old local eligibility cannot grant deletion.
  if (!branch.head) return undefined;
  if (isMerged({ branchName: branch.head, trunkName: trunk }))
    return `${branch.branchName} is merged into ${trunkName}`;
  if (isDiffEmpty(branch.head, branch.base))
    return `${branch.branchName} is empty`;
  return undefined;
}

function cleanupClosure(
  branches: readonly CleanupBranch[],
  deleting: readonly string[],
  {
    trunkName,
    trunkHead,
    root,
  }: {
    readonly trunkName: string;
    readonly trunkHead: string;
    readonly root?: string;
  }
) {
  const byName = new Map(branches.map((branch) => [branch.branchName, branch]));
  const descendants = (name: string): boolean => {
    const parent = byName.get(name)?.parent;
    return parent !== undefined && (parent === root || descendants(parent));
  };
  const parents: { branchName: string; parent: string }[] = [];
  const replay: string[] = [];
  const affected = new Set<string>();
  const ordered: CleanupBranch[] = [];
  const visit = (branch: CleanupBranch): void => {
    if (ordered.includes(branch)) return;
    const parent = byName.get(branch.parent);
    if (parent) visit(parent);
    ordered.push(branch);
  };
  branches.forEach(visit);
  for (const branch of ordered) {
    if (
      deleting.includes(branch.branchName) ||
      (root && !descendants(branch.branchName))
    )
      continue;
    let parent = branch.parent;
    while (deleting.includes(parent))
      parent = byName.get(parent)?.parent ?? trunkName;
    const changedParent = parent !== branch.parent;
    if (changedParent) parents.push({ branchName: branch.branchName, parent });
    const parentHead = byName.get(parent)?.head ?? trunkHead;
    if (changedParent || affected.has(branch.parent)) {
      if (
        branch.base !== parentHead ||
        affected.has(parent) ||
        (!byName.get(parent)?.head && byName.has(parent))
      ) {
        replay.push(branch.branchName);
        affected.add(branch.branchName);
      }
    }
  }
  return {
    parents,
    replay,
    mandatory: [
      ...new Set([...parents.map((entry) => entry.branchName), ...replay]),
    ],
  };
}

export function assertSyncCleanupAvailable(
  plan: SyncCleanupPlan,
  context: TContext
): void {
  if (!plan.accepted.length) return;
  for (const name of plan.mandatory) context.engine.assertBranchEditable(name);
  if (plan.restack && plan.replay.length) assertNoGitOperation('sync cleanup');
  assertBranchesAvailableInWorktrees([...plan.accepted, ...plan.mandatory]);
  const checkout = plan.accepted.includes(context.engine.currentBranch ?? '')
    ? [
        plan.trunkHead,
        ...plan.accepted.map((name) => {
          const parent =
            plan.branches.find((entry) => entry.branchName === name)?.parent ??
            context.engine.trunk;
          return (
            plan.branches.find((entry) => entry.branchName === parent)?.head ??
            context.engine.getRevision(parent)
          );
        }),
      ]
    : [];
  assertRestackFilesAvailable({
    branches: plan.restack
      ? plan.replay.map((name) => ({
          name,
          from: context.engine.getBaseRevision(name),
        }))
      : [],
    checkoutRevisions: checkout,
    operation: 'get',
  });
}

export function assertSyncCleanupSnapshot(plan: SyncCleanupPlan): void {
  for (const branch of plan.branches) {
    if (
      getSha(`refs/heads/${branch.branchName}`) !== branch.previousHead ||
      getSha(`refs/branch-metadata/${branch.branchName}`) !==
        branch.previousMetadata
    )
      throw new ExitFailedError(
        `${branch.branchName} changed while collecting sync choices. Replan before applying incoming updates.`
      );
  }
}

/** Consume finite decisions; never rediscover candidates after applying sources. */
export function applySyncCleanup(
  plan: SyncCleanupPlan,
  context: TContext,
  progress: SyncCleanupProgress
): void {
  const expected = new Map(
    plan.branches.map((entry) => [
      entry.branchName,
      {
        head: entry.head ?? getSha(`refs/heads/${entry.branchName}`),
        metadata: getSha(`refs/branch-metadata/${entry.branchName}`),
      },
    ])
  );
  const check = (): void => {
    assertSyncCleanupAvailable(plan, context);
    const names = Object.keys(getMetadataRefList()).filter(
      (name) => !progress.deleted.includes(name)
    );
    for (const name of names)
      if (!expected.has(name))
        throw new ExitFailedError(
          `Unexpected branch ${name} appeared during cleanup; replan sync.`
        );
    for (const entry of plan.branches) {
      if (progress.deleted.includes(entry.branchName)) continue;
      const previous = expected.get(entry.branchName);
      if (
        getSha(`refs/heads/${entry.branchName}`) !== previous?.head ||
        getSha(`refs/branch-metadata/${entry.branchName}`) !==
          previous?.metadata
      )
        throw new ExitFailedError(
          `${entry.branchName} changed during cleanup; reached changes are retained.`
        );
    }
    for (const name of plan.mandatory)
      context.engine.assertBranchEditable(name);
  };
  assertProjectedCleanup(plan, context);
  try {
    for (const entry of plan.parents) {
      check();
      context.engine.setParent(entry.branchName, entry.parent, plan.mandatory);
      expected.set(entry.branchName, {
        head: getSha(`refs/heads/${entry.branchName}`),
        metadata: getSha(`refs/branch-metadata/${entry.branchName}`),
      });
      progress.changed.push(entry.branchName);
      context.splog.info(
        `Set parent of ${chalk.cyan(entry.branchName)} to ${chalk.blueBright(
          entry.parent
        )}.`
      );
    }
    for (const name of plan.deletions) {
      check();
      try {
        context.engine.deleteBranch(name, check, {
          participants: plan.mandatory,
          onHeadDeleted: () => progress.deleted.push(name),
        });
      } catch (error) {
        if (progress.deleted.includes(name)) progress.incomplete.push(name);
        throw error;
      }
      context.splog.info(`Deleted branch ${chalk.red(name)}`);
    }
    check();
    if (!plan.restack && plan.replay.length)
      context.splog.info(
        `Pending restack: ${plan.replay.join(', ')} (--no-restack).`
      );
  } catch (error) {
    throw new ExitFailedError(
      `${
        error instanceof Error ? error.message : String(error)
      }\nConfirmed cleanup deletions: ${
        progress.deleted.join(', ') || 'none'
      }. Completed parent changes: ${
        progress.changed.join(', ') || 'none'
      }. Incomplete cleanup metadata: ${
        progress.incomplete.join(', ') || 'none'
      }. Remaining cleanup: ${
        plan.accepted
          .filter((name) => !progress.deleted.includes(name))
          .join(', ') || 'none'
      }. Completed cleanup changes are retained; inspect parents and remaining branches before retrying sync.`
    );
  }
}

function cleanupDepth(
  name: string,
  branches: readonly CleanupBranch[],
  deleting: readonly string[]
): number {
  const parent = branches.find((entry) => entry.branchName === name)?.parent;
  return parent && deleting.includes(parent)
    ? 1 + cleanupDepth(parent, branches, deleting)
    : 0;
}

function assertProjectedCleanup(
  plan: SyncCleanupPlan,
  context: TContext
): void {
  const prFields = [
    'number',
    'url',
    'state',
    'base',
    'title',
    'body',
    'isDraft',
    'reviewDecision',
  ] as const;
  for (const branch of plan.branches) {
    const metadata = readMetadataRef(branch.branchName);
    if (
      (branch.head &&
        getSha(`refs/heads/${branch.branchName}`) !== branch.head) ||
      metadata.parentBranchName !== branch.parent ||
      metadata.parentBranchRevision !== branch.base ||
      prFields.some(
        (field) => metadata.prInfo?.[field] !== branch.prInfo?.[field]
      ) ||
      (metadata.frozen === true) !== branch.frozen
    )
      throw new ExitFailedError(
        `${branch.branchName} differs from the projected cleanup graph. Inspect reached incoming updates before retrying sync.`
      );
  }
  for (const name of plan.accepted) {
    const branch = plan.branches.find((entry) => entry.branchName === name);
    if (
      !branch ||
      !cleanupReason(
        branch,
        context.engine.getRevision(context.engine.trunk),
        context.engine.trunk
      )
    )
      throw new ExitFailedError(
        `Cleanup eligibility changed for ${name}; replan sync.`
      );
  }
}
