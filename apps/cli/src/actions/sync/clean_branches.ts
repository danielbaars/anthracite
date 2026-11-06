import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { sameMetadataExceptFrozen } from '../../lib/engine/metadata_comparison';
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
import { lookupPullRequest } from './remote_update_graph';

type CleanupBranch = {
  readonly branchName: string;
  readonly previousHead: string;
  readonly previousMetadata: string;
  readonly parent: string;
  readonly head?: string;
  readonly base: string;
  readonly frozen: boolean;
  readonly prNumber?: number;
  readonly prHead?: string;
  readonly prInfo?: TBranchPRInfo;
  readonly state?: string;
};
export type SyncCleanupPlan = {
  readonly branches: readonly CleanupBranch[];
  readonly untouched: readonly {
    readonly branchName: string;
    readonly head: string;
    readonly metadata: string;
  }[];
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
  const untouched = Object.entries(getMetadataRefList())
    .filter(([name]) => !branches.some((branch) => branch.branchName === name))
    .map(([branchName, metadata]) => ({
      branchName,
      head: getSha(`refs/heads/${branchName}`),
      metadata,
    }));
  const trunk =
    refresh.trunk?.head ?? context.engine.getRevision(context.engine.trunk);
  const accepted: string[] = [];
  const declined: string[] = [];
  if (opts.delete)
    context.splog.info(
      '🧹 Checking if any branches have been merged/closed and can be deleted...'
    );
  let inspected = 0;
  for (const branch of opts.delete ? branches : []) {
    inspected++;
    if (opts.showDeleteProgress)
      context.splog.info(
        `${Math.round(
          (inspected / branches.length) * 100
        )}% done searching for merged/closed branches to delete...`
      );
    const reason = cleanupReason(branch, trunk, context.engine.trunk);
    if (!reason) {
      if (branch.state === 'CLOSED' || branch.state === 'MERGED')
        context.splog.info(
          `Keeping ${branch.branchName}: ${
            branch.prHead
              ? 'the terminal PR does not cover the current local head'
              : 'terminal PR coverage is not freshly verified'
          }. Local work is retained.`
        );
      continue;
    }
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
    untouched,
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
        prHead: freshPr?.headRefOid,
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
  if (
    (branch.state === 'CLOSED' || branch.state === 'MERGED') &&
    branch.head !== undefined &&
    branch.prHead === branch.head
  )
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
  for (const branch of [
    ...plan.branches.map((entry) => ({
      branchName: entry.branchName,
      head: entry.previousHead,
      metadata: entry.previousMetadata,
    })),
    ...plan.untouched,
  ]) {
    if (
      getSha(`refs/heads/${branch.branchName}`) !== branch.head ||
      getSha(`refs/branch-metadata/${branch.branchName}`) !== branch.metadata
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
  {
    progress,
    onProgress,
  }: {
    readonly progress: SyncCleanupProgress;
    readonly onProgress?: (
      branch: string,
      boundary: 'parent' | 'deleted' | 'metadata' | 'incomplete'
    ) => void;
  }
): void {
  const expected = new Map(
    [
      ...plan.branches.map((entry) => ({
        branchName: entry.branchName,
        head: entry.head ?? getSha(`refs/heads/${entry.branchName}`),
        metadata: getSha(`refs/branch-metadata/${entry.branchName}`),
      })),
      ...plan.untouched.map((entry) => ({
        ...entry,
        head:
          entry.branchName === context.engine.trunk
            ? plan.trunkHead
            : entry.head,
      })),
    ].map((entry) => [
      entry.branchName,
      { head: entry.head, metadata: entry.metadata },
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
    for (const entry of [...plan.branches, ...plan.untouched]) {
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
      const previous = expected.get(entry.branchName);
      if (!previous)
        throw new Error(`Unknown cleanup participant ${entry.branchName}.`);
      const metadata =
        context.engine.setParent(
          entry.branchName,
          entry.parent,
          plan.mandatory
        ) ?? previous.metadata;
      if (
        getSha(`refs/heads/${entry.branchName}`) !== previous.head ||
        !sameMetadataExceptFrozen(
          getSha(`refs/branch-metadata/${entry.branchName}`),
          metadata
        )
      )
        throw new ExitFailedError(
          `${entry.branchName} cleanup parent publication changed; reached work and concurrent changes are retained. Inspect manually before retrying.`
        );
      expected.set(entry.branchName, { head: previous.head, metadata });
      progress.changed.push(entry.branchName);
      onProgress?.(entry.branchName, 'parent');
      context.splog.info(
        `Set parent of ${chalk.cyan(entry.branchName)} to ${chalk.blueBright(
          entry.parent
        )}.`
      );
    }
    for (const name of plan.deletions) {
      verifySyncCleanupPrCoverage(plan, context, [name]);
      check();
      try {
        context.engine.deleteBranch(name, check, {
          participants: plan.mandatory,
          onHeadDeleted: () => {
            progress.deleted.push(name);
            onProgress?.(name, 'deleted');
          },
        });
      } catch (error) {
        if (progress.deleted.includes(name)) {
          progress.incomplete.push(name);
          onProgress?.(name, 'incomplete');
        }
        throw error;
      }
      onProgress?.(name, 'metadata');
      context.splog.info(`Deleted branch ${chalk.red(name)}`);
    }
    check();
    if (!plan.restack && plan.replay.length)
      context.splog.info(
        `Pending restack: ${plan.replay.join(', ')} (--no-restack).`
      );
  } catch (error) {
    reportSyncCleanupFailure(plan, progress, error);
  }
}

/** Terminal state is permission only for the exact local work selected for removal. */
export function verifySyncCleanupPrCoverage(
  plan: SyncCleanupPlan,
  context: TContext,
  names: readonly string[]
): SyncCleanupPlan {
  const verifiedHeads = new Map<string, string>();
  for (const name of names) {
    const branch = plan.branches.find((entry) => entry.branchName === name);
    if (!branch?.head)
      throw new ExitFailedError(`Missing protected cleanup head for ${name}.`);
    if (
      isMerged({ branchName: branch.head, trunkName: plan.trunkHead }) ||
      isDiffEmpty(branch.head, branch.base)
    )
      continue;
    if (!context.repoConfig.getIsGithubIntegrationEnabled())
      throw new ExitFailedError(
        `Pending PR-based sync cleanup requires GitHub read access for ${name}; cached terminal state is insufficient.`
      );
    if (!branch.prNumber)
      throw new ExitFailedError(
        `Missing saved cleanup PR identity for ${name}.`
      );
    const pr = lookupPullRequest(String(branch.prNumber), context, 'sync');
    if (
      !pr ||
      pr.headRefName !== name ||
      pr.number !== branch.prNumber ||
      pr.url !== branch.prInfo?.url ||
      pr.state !== branch.state ||
      (pr.state !== 'CLOSED' && pr.state !== 'MERGED') ||
      pr.baseRefName !== branch.prInfo?.base ||
      pr.headRefOid !== branch.head ||
      (branch.prHead !== undefined && pr.headRefOid !== branch.prHead) ||
      getSha(`refs/heads/${name}`) !== branch.head
    )
      throw new ExitFailedError(
        `Pending cleanup PR identity/state/head changed or does not cover current work for ${name}; local work and reached progress are retained.`
      );
    verifiedHeads.set(name, pr.headRefOid);
  }
  // Older saved plans gain fresh application evidence without rewriting recovery.
  return {
    ...plan,
    branches: plan.branches.map((branch) => {
      const prHead = verifiedHeads.get(branch.branchName);
      return prHead ? { ...branch, prHead } : branch;
    }),
  };
}

function reportSyncCleanupFailure(
  plan: SyncCleanupPlan,
  progress: SyncCleanupProgress,
  error: unknown
): never {
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
      )
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
