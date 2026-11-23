import { execFileSync } from 'child_process';
import { z } from 'zod';
import { TContext } from '../../lib/context';
import { getGithubPr } from '../../lib/api/github_pr';
import { assertBranchNotFrozen } from '../../lib/engine/frozen_branch';
import {
  assertSyncReconciliationPins,
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
    replacement: z.object({ from: oid }).strict().optional(),
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
    const selected = await chooseReconciliationReplay(plan, entry, context);
    if (selected) planned.push(selected);
  }
  return planned;
}

async function chooseReconciliationReplay(
  plan: SyncReconciliationReplay,
  entry: SyncReconciliation,
  context: TContext
): Promise<SyncReconciliationReplay | undefined> {
  const localIsClean = await assessSource(plan, 'Local', context);
  if (
    localIsClean &&
    compareBranchWork(entry, {
      baseTip: plan.publishedBaseTip,
      head: plan.publishedHead,
    }).kind === 'equivalent'
  ) {
    context.splog.info(
      `Verified equivalent work on ${plan.branch}; keeping local commits and replaying them onto ${context.engine.trunk}.`
    );
    return plan;
  }

  const published = planPublishedReplay(plan);
  const publishedIsClean = published
    ? await assessSource(published, 'GitHub', context)
    : false;
  if (!published)
    context.splog.info(
      `GitHub replay of ${plan.branch} onto ${context.engine.trunk}: replay feasibility could not be verified.`
    );
  if (!context.canPrompt || (!localIsClean && !publishedIsClean))
    return undefined;

  if (localIsClean)
    context.splog.info(
      `Keeping local commits on ${plan.branch} will replay them onto ${context.engine.trunk} without publishing.`
    );
  context.splog.info('Deferring keeps both local tips for recovery.');
  const { choice } = await context.prompts({
    type: 'select',
    name: 'choice',
    message: `Reconcile ${plan.branch} (PR #${plan.pullRequest})?`,
    choices: [
      ...(localIsClean
        ? [
            {
              title: 'Keep my local commits and replay them onto trunk',
              value: 'local',
            },
          ]
        : []),
      ...(publishedIsClean
        ? [
            {
              title: 'Review taking the verified GitHub version',
              value: 'published',
            },
          ]
        : []),
      {
        title: 'Keep these branches as they are and continue syncing',
        value: 'defer',
      },
    ],
    initial: !localIsClean && publishedIsClean ? 1 : 0,
  });
  if (choice === 'local') return plan;
  if (choice === 'published' && published)
    return confirmPublishedReplay(published, context);
  return undefined;
}

export function reconciliationReplayRange(plan: SyncReconciliationReplay): {
  readonly branch: string;
  readonly head: string;
  readonly from: string;
  readonly onto: string;
} {
  const { branch, onto } = plan;
  return plan.replacement
    ? { branch, head: plan.publishedHead, from: plan.replacement.from, onto }
    : { branch, head: plan.head, from: plan.from, onto };
}

function planPublishedReplay(
  plan: SyncReconciliationReplay
): SyncReconciliationReplay | undefined {
  const base = readReconciliationGit([
    'merge-base',
    '--all',
    plan.onto,
    plan.publishedHead,
  ]);
  if (
    !base ||
    !oid.safeParse(base).success ||
    !hasCanonicalAncestry(base, plan.publishedHead) ||
    !hasCanonicalAncestry(base, plan.onto)
  )
    return undefined;
  return { ...plan, replacement: { from: base } };
}

async function assessSource(
  plan: SyncReconciliationReplay,
  label: 'Local' | 'GitHub',
  context: TContext
): Promise<boolean> {
  const assessment = await inspectLocalReplay(reconciliationReplayRange(plan));
  if (assessment.status === 'clean') return true;
  const reason =
    assessment.status === 'conflict'
      ? `conflicts in ${assessment.paths
          .map(safeDiagnostic)
          .join(', ')}. Later commits were not assessed.`
      : 'replay feasibility could not be verified.';
  context.splog.info(
    `${label} replay of ${plan.branch} onto ${context.engine.trunk}: ${reason} Keeping local work pending reconciliation unless another resolution is chosen.`
  );
  if (assessment.status === 'unavailable')
    context.splog.debug(safeDiagnostic(assessment.reason));
  return false;
}

function readReconciliationGit(args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', ['--no-replace-objects', ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1000,
      maxBuffer: 64 * 1024,
    }).trim();
  } catch {
    return undefined;
  }
}

async function confirmPublishedReplay(
  plan: SyncReconciliationReplay,
  context: TContext
): Promise<SyncReconciliationReplay | undefined> {
  const localCommits = readReconciliationGit([
    'log',
    '--no-show-signature',
    '--no-notes',
    '--max-count=129',
    '--format=%h %s',
    `${plan.publishedHead}..${plan.head}`,
    `^${plan.from}`,
    '--',
  ])
    ?.split('\n')
    .filter(Boolean);
  if (!localCommits || localCommits.length > 128) {
    context.splog.info(
      `Could not verify which local commits would leave ${plan.branch}. Keeping local work.`
    );
    return undefined;
  }
  context.splog.info(
    `Taking GitHub tip ${plan.publishedHead.slice(0, 8)} (PR #${
      plan.pullRequest
    }) replaces ${plan.branch} at local tip ${plan.head.slice(0, 8)}.`
  );
  if (localCommits.length) {
    context.splog.info(
      'Local commit IDs that will leave this branch (some changes may be present under other IDs):'
    );
    for (const commit of localCommits)
      context.splog.info(`  ${safeDiagnostic(commit)}`);
  } else
    context.splog.info(
      'The published history already contains all local branch commit IDs.'
    );
  context.splog.info(
    plan.replacement?.from === plan.onto
      ? 'The GitHub version is already based on the verified new trunk.'
      : `Sync will replay the GitHub commits onto ${context.engine.trunk} before restoring the active stack.`
  );
  const { confirmed } = await context.prompts({
    type: 'confirm',
    name: 'confirmed',
    message: `Replace local ${plan.branch} with the verified GitHub version?`,
    initial: false,
  });
  return confirmed === true ? plan : undefined;
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
  const selectedHead = reconciliationReplayRange(plan).head;
  const expectedHead = operation.expected.find(
    ({ branchName }) => branchName === plan.branch
  )?.head;
  const allowedHead =
    plan.replacement &&
    operation.reconciling === plan.branch &&
    expectedHead === selectedHead
      ? selectedHead
      : plan.head;
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
    (checkHead && getSha(`refs/heads/${plan.branch}`) !== allowedHead) ||
    getSha(`refs/branch-metadata/${plan.branch}`) !== plan.metadata
  )
    throw new ExitFailedError(
      `Captured reconciliation inputs for ${plan.branch} changed. Keeping local work.`
    );
  assertSyncReconciliationPins(entry);
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
  const range = reconciliationReplayRange(plan);
  assertRestackFilesAvailable({
    branches: [{ name: plan.branch, from: range.from, head: range.head }],
    checkoutRevisions: [plan.onto],
    operation: 'get',
  });
}
