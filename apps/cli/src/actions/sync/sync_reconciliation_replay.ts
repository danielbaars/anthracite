import { z } from 'zod';
import { TContext } from '../../lib/context';
import { getGithubPr } from '../../lib/api/github_pr';
import { assertBranchNotFrozen } from '../../lib/engine/frozen_branch';
import {
  readSyncReconciliation,
  SyncReconciliation,
} from '../../lib/engine/sync_reconciliation';
import { ExitFailedError } from '../../lib/errors';
import { getSha } from '../../lib/git/get_sha';
import { runGitCommand } from '../../lib/git/runner';
import { inspectLocalReplay } from '../../lib/git/landing_replay';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { compareBranchWork, hasCanonicalAncestry } from './local_restack';
import type { SyncOperation } from './sync_operation';
import type { SyncRefreshPlan } from './sync_refresh';

const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const syncReconciliationReplaySchema = z
  .object({
    branch: z.string().min(1),
    head: oid,
    from: oid,
    onto: oid,
    metadata: oid,
    pullRequest: z.number().int().positive(),
    publishedHead: oid,
    publishedBaseTip: oid,
    formerParent: z.string().min(1),
    formerParentHead: oid,
    formerParentPr: z.number().int().positive(),
    mergedHead: oid,
  })
  .strict();

export type SyncReconciliationReplay = z.infer<
  typeof syncReconciliationReplaySchema
>;

export async function planSyncReconciliationReplays(
  options: {
    readonly entries: readonly SyncReconciliation[];
    readonly nodes: SyncRefreshPlan['nodes'];
    readonly prs: SyncRefreshPlan['prs'];
    readonly onto: string;
    readonly restack: boolean;
  },
  context: TContext
): Promise<SyncReconciliationReplay[]> {
  if (!options.restack) return [];
  const planned: SyncReconciliationReplay[] = [];
  for (const entry of options.entries) {
    const node = options.nodes.find(
      ({ branchName }) => branchName === entry.branch
    );
    const pr = options.prs.find(({ number }) => number === entry.pullRequest);
    const former = options.prs.find(
      ({ number }) => number === entry.formerParentPr
    );
    if (
      !node ||
      !pr?.baseRefOid ||
      !hasCanonicalAncestry(pr.baseRefOid, options.onto) ||
      node.head !== entry.publishedHead ||
      node.previousHead !== entry.head ||
      node.previousBase !== entry.base ||
      node.previousMetadata !== entry.metadata ||
      node.previousParentBranchName !== entry.formerParent ||
      node.pullRequestNumber !== entry.pullRequest ||
      pr.headRefName !== entry.branch ||
      pr.baseRefName !== context.engine.trunk ||
      pr.state !== 'OPEN' ||
      pr.headRefOid !== node.head ||
      former?.headRefName !== entry.formerParent ||
      former.state !== 'MERGED' ||
      former.baseRefName !== context.engine.trunk ||
      former.headRefOid !== entry.mergedHead
    )
      continue;
    if (
      options.entries.some(
        (other) =>
          other.branch !== entry.branch &&
          (other.formerParent === entry.branch ||
            other.dependents?.includes(entry.branch))
      )
    )
      continue;
    if (context.engine.isBranchFrozen(entry.branch)) {
      context.splog.info(
        `Keeping frozen branch ${entry.branch} pending reconciliation.`
      );
      continue;
    }
    const plan: SyncReconciliationReplay = {
      branch: entry.branch,
      head: entry.head,
      from: entry.base,
      onto: options.onto,
      metadata: entry.metadata,
      pullRequest: entry.pullRequest,
      publishedHead: node.head,
      publishedBaseTip: pr.baseRefOid,
      formerParent: entry.formerParent,
      formerParentHead: entry.formerParentHead,
      formerParentPr: entry.formerParentPr,
      mergedHead: entry.mergedHead,
    };
    const assessment = await inspectLocalReplay(plan);
    if (assessment.status !== 'clean') {
      const reason =
        assessment.status === 'conflict'
          ? `conflicts in ${assessment.paths
              .map(safeDiagnostic)
              .join(', ')}. Later commits were not assessed.`
          : 'replay feasibility could not be verified.';
      context.splog.info(
        `Local replay of ${entry.branch} onto ${context.engine.trunk}: ${reason} Keeping local work pending reconciliation.`
      );
      if (assessment.status === 'unavailable')
        context.splog.debug(safeDiagnostic(assessment.reason));
      continue;
    }
    const comparison = compareBranchWork(entry, {
      baseTip: pr.baseRefOid,
      head: node.head,
    });
    if (comparison.kind === 'equivalent') {
      context.splog.info(
        `Verified equivalent work on ${entry.branch}; keeping local commits and replaying them onto ${context.engine.trunk}.`
      );
      planned.push(plan);
      continue;
    }
    if (!context.canPrompt) continue;
    context.splog.info(
      `Keeping local commits on ${entry.branch} will replay them onto ${context.engine.trunk} without publishing. Deferring keeps both local tips for recovery.`
    );
    const { choice } = await context.prompts({
      type: 'select',
      name: 'choice',
      message: `Reconcile ${entry.branch} (PR #${entry.pullRequest})?`,
      choices: [
        {
          title: 'Keep my local commits and replay them onto trunk',
          value: 'local',
        },
        {
          title: 'Keep these branches as they are and continue syncing',
          value: 'defer',
        },
      ],
    });
    if (choice === 'local') planned.push(plan);
  }
  return planned;
}

function safeDiagnostic(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '�');
}

export function ownedSyncReconciliation(
  operation: SyncOperation,
  branch: string
): SyncReconciliationReplay | undefined {
  return operation.phase === 'maintenance' &&
    operation.reconciling === branch &&
    !operation.completedMaintenance.includes(branch)
    ? operation.refresh.reconciliation?.find((entry) => entry.branch === branch)
    : undefined;
}

export function assertSyncReconciliationLocalInputs(
  plan: SyncReconciliationReplay,
  operation: SyncOperation,
  { checkHead = true }: { readonly checkHead?: boolean } = {}
): void {
  const entry = readSyncReconciliation().entries.find(
    ({ branch }) => branch === plan.branch
  );
  if (
    !entry ||
    entry.head !== plan.head ||
    entry.base !== plan.from ||
    entry.metadata !== plan.metadata ||
    entry.pullRequest !== plan.pullRequest ||
    entry.publishedHead !== plan.publishedHead ||
    entry.pullRequestBase !== operation.trunkName ||
    entry.formerParent !== plan.formerParent ||
    entry.formerParentHead !== plan.formerParentHead ||
    entry.formerParentPr !== plan.formerParentPr ||
    entry.mergedHead !== plan.mergedHead ||
    getSha(`refs/heads/${operation.trunkName}`) !== plan.onto ||
    getSha(`refs/heads/${plan.formerParent}`) !== plan.formerParentHead ||
    (checkHead && getSha(`refs/heads/${plan.branch}`) !== plan.head) ||
    getSha(`refs/branch-metadata/${plan.branch}`) !== plan.metadata
  )
    throw new ExitFailedError(
      `Captured reconciliation inputs for ${plan.branch} changed. Keeping local work.`
    );
  assertBranchNotFrozen(plan.branch);
  assertBranchesAvailableInWorktrees([plan.branch]);
}

export async function assertSyncReconciliationSource(
  plan: SyncReconciliationReplay,
  context: TContext
): Promise<void> {
  if (!context.repoConfig.getIsGithubIntegrationEnabled())
    throw new ExitFailedError(
      'Sync reconciliation requires current GitHub evidence.'
    );
  const [pr, former] = await Promise.all([
    getGithubPr(plan.branch, context, 'current'),
    getGithubPr(plan.formerParent, context),
  ]);
  const trunkRef = `refs/heads/${context.engine.trunk}`;
  const branchRef = `refs/heads/${plan.branch}`;
  const remoteHeads = new Map(
    runGitCommand({
      args: [
        'ls-remote',
        '--refs',
        context.repoConfig.getRemote(),
        trunkRef,
        branchRef,
      ],
      options: { timeout: 5000 },
      onError: 'ignore',
      resource: 'verifySyncReconciliationRemote',
    })
      .split('\n')
      .map((line) => line.split('\t'))
      .map(([oid, ref]) => [ref, oid])
  );
  if (
    remoteHeads.get(trunkRef) !== plan.onto ||
    remoteHeads.get(branchRef) !== plan.publishedHead ||
    pr?.number !== plan.pullRequest ||
    pr.headRefOid !== plan.publishedHead ||
    pr.baseRefOid !== plan.publishedBaseTip ||
    pr.baseRefName !== context.engine.trunk ||
    pr.state !== 'OPEN' ||
    former?.number !== plan.formerParentPr ||
    former.headRefOid !== plan.mergedHead ||
    former.baseRefName !== context.engine.trunk ||
    former.state !== 'MERGED'
  )
    throw new ExitFailedError(
      `GitHub reconciliation evidence changed for ${plan.branch}. Keeping local work.`
    );
}

export function assertSyncReconciliationFiles(
  plan: SyncReconciliationReplay
): void {
  uncommittedTrackedChangesPrecondition();
  assertRestackFilesAvailable({
    branches: [{ name: plan.branch, from: plan.from }],
    checkoutRevisions: [plan.onto],
    operation: 'get',
  });
}
