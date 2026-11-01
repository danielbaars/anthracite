import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { getBranchesFromRemote, prepareRemoteUpdates } from './get';
import { captureGetCheckout, finishGetCheckout } from './get_checkout';
import {
  lookupPullRequest,
  orderRemoteUpdateGraph,
  releaseRemoteUpdateGraph,
  RemoteUpdateSelection,
  snapshotRemoteUpdateGraph,
  snapshotSelection,
} from './remote_update_graph';

/** Sync refreshes only the configured trunk's existing tracked graph. */
export async function refreshSyncFeatures(context: TContext): Promise<void> {
  if (!context.repoConfig.getIsGithubIntegrationEnabled()) {
    context.splog.info(
      'GitHub integration is disabled; PR information and feature refresh skipped. Cached PR states are not freshly verified.'
    );
    return;
  }
  const original = captureGetCheckout();
  const selected: RemoteUpdateSelection[] = [];
  const prs = [];
  for (const branch of context.engine.allBranchNames.sort()) {
    if (
      context.engine.isTrunk(branch) ||
      !context.engine.isBranchTracked(branch)
    )
      continue;
    const association = context.engine.getPrInfo(branch)?.number;
    const pr = lookupPullRequest(
      association ? String(association) : branch,
      context,
      'sync'
    );
    if (!pr) {
      if (association)
        throw new ExitFailedError(
          `Required associated pull request ${association} for ${branch} is missing.`
        );
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
  const nodes = snapshotRemoteUpdateGraph(
    orderRemoteUpdateGraph(selected, context),
    context
  );
  try {
    await prepareRemoteUpdates(
      {
        nodes,
        force: false,
        target: 'branchName' in original ? original.branchName : undefined,
        finalBranch: 'branchName' in original ? original.branchName : undefined,
      },
      context
    );
    const updated = await getBranchesFromRemote(
      {
        downstack: nodes.map((node) => node.branchName),
        base: context.engine.trunk,
        nodes,
        force: false,
      },
      context
    );
    for (const pr of prs)
      context.engine.upsertPrInfo(pr.headRefName, {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        base: pr.baseRefName,
        title: pr.title,
        body: pr.body,
        isDraft: pr.isDraft,
        reviewDecision: pr.reviewDecision || undefined,
      });
    finishGetCheckout(
      { target: context.engine.trunk, original, shouldCheckout: false },
      updated
    );
  } finally {
    releaseRemoteUpdateGraph(nodes);
  }
}
