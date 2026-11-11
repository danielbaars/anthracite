import { getGithubPr } from '../../lib/api/github_pr';
import { TBranchPRInfo } from '../../lib/engine/metadata_ref';
import { getSha } from '../../lib/git/get_sha';
import { TContext } from '../../lib/context';
import { ExitFailedError, KilledError } from '../../lib/errors';
import {
  snapshotRemoteTrunk,
  releaseRemoteTrunk,
  RemoteTrunkUpdate,
} from './remote_update_trunk';
import { prepareRemoteUpdates } from './get';
import {
  hasCanonicalAncestry,
  hasEquivalentLocalRestack,
} from './local_restack';
import { captureGetCheckout } from './get_checkout';
import {
  lookupPullRequest,
  pullRequestSchema,
  assertRemoteUpdateNodeUnchanged,
  orderRemoteUpdateGraph,
  releaseRemoteUpdateGraph,
  RemoteUpdateSelection,
  RemoteUpdateNode,
  snapshotRemoteUpdateGraph,
  snapshotSelection,
} from './remote_update_graph';

export type SyncRefreshPlan = {
  readonly trunkHead: string;
  readonly originalHead: string;
  readonly original: ReturnType<typeof captureGetCheckout>;
  readonly trunk?: RemoteTrunkUpdate;
  readonly nodes: ReturnType<typeof snapshotRemoteUpdateGraph>;
  readonly preserved?: readonly string[];
  readonly prs: Awaited<ReturnType<typeof selectSyncFeatures>>['prs'];
};

/** Snapshot sources and collect all reconciliation authority before application. */
export async function prepareSyncRefresh(
  opts: { pull: boolean; force: boolean },
  context: TContext
): Promise<SyncRefreshPlan> {
  const original = captureGetCheckout();
  const originalHead = getSha('HEAD');
  const trunkHead = getSha(`refs/heads/${context.engine.trunk}`);
  const trunk = opts.pull ? snapshotRemoteTrunk(context, 'sync') : undefined;
  let nodes: ReturnType<typeof snapshotRemoteUpdateGraph> = [];
  try {
    const { selected, prs } = await selectSyncFeatures(context);
    nodes = snapshotRemoteUpdateGraph(
      orderRemoteUpdateGraph(selected, context),
      context,
      trunk
    );
    // Keep the local replay boundary until cleanup decides the merged parent.
    for (const node of [...nodes]) {
      if (!isLocalAheadMergeSurvivor(node, prs, context)) continue;
      assertRemoteUpdateNodeUnchanged(node);
      releaseRemoteUpdateGraph([node]);
      nodes = nodes.filter((candidate) => candidate !== node);
      context.splog.info(
        `${node.branchName} is ahead of remote; keeping its local commits.`
      );
    }
    const preserved = nodes
      .filter((node) => {
        if (
          node.previousParentBranchName === node.parentBranchName &&
          node.previousHead !== node.head &&
          hasCanonicalAncestry(node.head, node.previousHead)
        )
          return true;
        if (
          node.parentBranchName !== context.engine.trunk ||
          !hasEquivalentLocalRestack(node)
        )
          return false;
        context.splog.info(
          `🔁 ${node.branchName}: local restack on newer ${node.parentBranchName}; branch commits match remote. Publication is pending.`
        );
        return true;
      })
      .map((node) => {
        assertRemoteUpdateNodeUnchanged(node);
        return node.branchName;
      });
    await prepareRemoteUpdates(
      {
        nodes: nodes.filter((node) => !preserved.includes(node.branchName)),
        force: false,
        scope: 'sync',
        trunk,
        target: 'branchName' in original ? original.branchName : undefined,
        finalBranch: 'branchName' in original ? original.branchName : undefined,
      },
      context
    );
    if (trunk?.reset) await confirmSyncTrunkReset(trunk, opts.force, context);
    return {
      original,
      originalHead,
      trunkHead,
      trunk,
      nodes,
      prs,
      ...(preserved.length ? { preserved } : {}),
    };
  } catch (error) {
    releaseRemoteUpdateGraph(nodes);
    if (trunk) releaseRemoteTrunk(trunk);
    throw error;
  }
}

function isLocalAheadMergeSurvivor(
  node: RemoteUpdateNode,
  prs: SyncRefreshPlan['prs'],
  context: TContext
): boolean {
  const parent = prs.find(
    (pr) => pr.headRefName === node.previousParentBranchName
  );
  return (
    parent?.state === 'MERGED' &&
    node.parentBranchName === context.engine.trunk &&
    parent.baseRefName === node.parentBranchName &&
    parent.headRefOid === getSha(`refs/heads/${parent.headRefName}`) &&
    node.previousHead !== node.head &&
    hasCanonicalAncestry(node.head, node.previousHead)
  );
}

export function getSyncPullRequestInfo(
  pr: SyncRefreshPlan['prs'][number]
): TBranchPRInfo {
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    base: pr.baseRefName,
    title: pr.title,
    body: pr.body,
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision || undefined,
  };
}

export function releaseSyncRefresh(plan: SyncRefreshPlan): void {
  releaseRemoteUpdateGraph(plan.nodes);
  if (plan.trunk) releaseRemoteTrunk(plan.trunk);
}

async function confirmSyncTrunkReset(
  trunk: RemoteTrunkUpdate,
  force: boolean,
  context: TContext
): Promise<void> {
  if (force) return;
  if (!context.interactive)
    throw new ExitFailedError(
      `Trunk ${trunk.branchName} is ahead of or diverged from remote. Sync requires --force or an affirmative terminal reset choice. --delete-all only authorizes cleanup.`
    );
  if (
    !(
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: `Overwrite ${trunk.branchName} with the version from remote?`,
        initial: false,
      })
    ).value
  )
    throw new KilledError();
}

async function selectSyncFeatures(context: TContext) {
  if (!context.repoConfig.getIsGithubIntegrationEnabled()) {
    context.splog.info(
      'GitHub integration is disabled; PR information and feature refresh skipped. Cached PR states are not freshly verified.'
    );
    return { selected: [], prs: [] };
  }
  const selected: RemoteUpdateSelection[] = [];
  const prs = [];
  for (const branch of context.engine.allBranchNames.sort()) {
    if (
      context.engine.isTrunk(branch) ||
      !context.engine.isBranchTracked(branch)
    )
      continue;
    const association = context.engine.getPrInfo(branch)?.number;
    const pr = await getCurrentSyncPullRequest(branch, context);
    if (!pr) {
      context.splog.info(
        `${branch} is local-only; remote refresh skipped (no pull request).`
      );
      continue;
    }
    if (pr.headRefName !== branch)
      throw new ExitFailedError(`Invalid pull request identity for ${branch}.`);
    if (!association && pr.state !== 'OPEN') {
      context.splog.info(
        `${branch} is local-only; remote refresh skipped (no open pull request).`
      );
      continue;
    }
    prs.push(pr);
    if (pr.state !== 'OPEN') {
      context.splog.info(
        `${branch} has a ${pr.state?.toLowerCase()} pull request; feature refresh skipped, pending separately authorized cleanup.`
      );
      continue;
    }
    selected.push(snapshotSelection(branch, pr));
  }
  return { selected, prs };
}

async function getCurrentSyncPullRequest(
  branch: string,
  context: TContext
): Promise<ReturnType<typeof lookupPullRequest>> {
  try {
    let pr = await getGithubPr(branch, context, 'current');
    if (!pr && context.engine.getPrInfo(branch)?.number !== undefined) {
      pr = await getGithubPr(branch, context);
      if (pr?.state === 'OPEN')
        throw new ExitFailedError(
          `GitHub PR state changed during discovery for ${branch}; retry sync.`
        );
    }
    return pr
      ? pullRequestSchema.parse({
          ...pr,
          reviewDecision: pr.reviewDecision || undefined,
        })
      : undefined;
  } catch (error) {
    if (
      error instanceof Error &&
      /identity|same-repository|Malformed|association/.test(error.message)
    )
      throw new ExitFailedError(
        `Invalid pull request identity for ${branch}. ${error.message}`
      );
    throw error;
  }
}
