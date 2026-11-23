import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { inspectionGithubRepo } from '../../lib/api/github_pr';
import { githubProcessOptions } from '../../lib/api/github_process';
import { TContext } from '../../lib/context';
import { getSha } from '../../lib/git/get_sha';
import { SyncReconciliation } from '../../lib/engine/sync_reconciliation';
import { BranchWorkComparison, compareBranchWork } from './local_restack';
import { RemoteUpdateNode } from './remote_update_graph';

const execFileAsync = promisify(execFile);
const pushActivity = z.object({
  ref: z.string(),
  after: z.string(),
  activity_type: z.enum(['push', 'force_push']),
  timestamp: z.iso.datetime(),
});

type ReconciliationPr = {
  readonly number: number;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  readonly baseRefOid?: string;
  readonly state?: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly mergedAt?: string | null;
};

type Evidence = {
  readonly entry: SyncReconciliation;
  readonly node?: RemoteUpdateNode;
  readonly parent?: ReconciliationPr;
  readonly published?: ReconciliationPr;
};

export async function reportSyncReconciliationEvidence(
  evidence: Evidence,
  context: TContext,
  level: 'info' | 'debug'
): Promise<void> {
  for (const line of await describeSyncReconciliation(evidence, context))
    context.splog[level](line.replace(/[\p{Cc}\p{Cf}]/gu, '�'));
}

async function describeSyncReconciliation(
  { entry, node, parent, published }: Evidence,
  context: TContext
): Promise<string[]> {
  const { branch, formerParent, pullRequest, pullRequestBase, formerParentPr } =
    entry;
  if (
    !node ||
    node.pullRequestNumber !== pullRequest ||
    node.parentBranchName !== pullRequestBase ||
    node.head !== entry.publishedHead ||
    node.previousHead !== entry.head ||
    node.previousParentBranchName !== formerParent ||
    node.previousBase !== entry.base ||
    node.previousMetadata !== entry.metadata ||
    published?.state !== 'OPEN' ||
    published.headRefName !== branch ||
    published.headRefOid !== node.head ||
    published.baseRefName !== pullRequestBase ||
    parent?.number !== formerParentPr ||
    parent.headRefName !== formerParent ||
    parent.headRefOid !== entry.mergedHead ||
    parent.baseRefName !== pullRequestBase ||
    parent.state !== 'MERGED' ||
    getSha(`refs/heads/${formerParent}`) !== entry.formerParentHead
  ) {
    return [
      `Comparison unavailable for ${branch} (PR #${pullRequest}): current branch and PR evidence does not match the saved transition from ${formerParent} (PR #${formerParentPr}).`,
    ];
  }
  const comparison = published.baseRefOid
    ? compareBranchWork(entry, {
        baseTip: published.baseRefOid,
        head: node.head,
      })
    : { kind: 'unknown' as const };
  const pushed = await findVerifiedPushTime(entry, context);
  const mergedAt = parent.mergedAt ? formatTime(new Date(parent.mergedAt)) : '';
  return [
    `${branch} (PR #${pullRequest}) now targets ${pullRequestBase} on GitHub.`,
    `  Local parent: ${formerParent} (PR #${formerParentPr}) at ${entry.formerParentHead.slice(
      0,
      8
    )}.`,
    `  ${formerParent} (PR #${formerParentPr}) was merged into ${pullRequestBase}. Merged PR head: ${entry.mergedHead.slice(
      0,
      8
    )}.`,
    ...(entry.formerParentHead !== entry.mergedHead
      ? ['  The merged PR head differs from the former local parent tip.']
      : []),
    ...(mergedAt ? [`  Merged: ${mergedAt}`] : []),
    `  Local tip: ${entry.head.slice(0, 8)}. GitHub tip: ${node.head.slice(
      0,
      8
    )}.`,
    ...branchTimes(entry, pushed),
    `  ${describeWork(comparison)}`,
  ];
}

function describeWork(comparison: BranchWorkComparison): string {
  if (comparison.kind === 'unknown')
    return 'Comparison unavailable: could not verify both branch commit ranges.';
  const { localCount, publishedCount, matchingPatches } = comparison;
  if (comparison.kind === 'equivalent')
    return `Equivalent branch work: ${localCount} own ${
      localCount === 1 ? 'commit matches' : 'commits match'
    } in order.`;
  let difference = 'Branch patches differ.';
  if (matchingPatches === Math.min(localCount, publishedCount)) {
    difference =
      localCount === publishedCount
        ? 'Patches match, but commit authorship or messages differ.'
        : 'Branch histories contain different numbers of commits.';
  }
  return `${difference} Local commits: ${localCount}. GitHub commits: ${publishedCount}. Patches matching at the same position: ${matchingPatches}.`;
}

function branchTimes(entry: SyncReconciliation, pushed: string): string[] {
  const localRef = `refs/heads/${entry.branch}`;
  const reflog = readGit([
    'reflog',
    'show',
    '-1',
    '--date=unix',
    '--format=%H%n%gD',
    localRef,
    '--',
  ]);
  const [head, selector] = reflog.split('\n');
  const recorded = selector?.slice(localRef.length).match(/^@\{(-?\d+)\}$/);
  const localUpdated =
    head === entry.head && selector?.startsWith(localRef) && recorded
      ? formatUnixTime(recorded[1])
      : '';
  const output = [
    ['Local update', localUpdated],
    ['Local commit', commitTime(entry.head)],
    ['GitHub push', pushed],
    ['GitHub commit', commitTime(entry.publishedHead)],
  ];
  return output.flatMap(([label, time]) =>
    time ? [`  ${label}: ${time}`] : []
  );
}

function commitTime(oid: string): string {
  return formatUnixTime(
    readGit([
      'show',
      '--no-patch',
      '--no-notes',
      '--no-show-signature',
      '--format=%ct',
      oid,
    ])
  );
}

function formatUnixTime(seconds: string): string {
  return /^-?\d+$/.test(seconds)
    ? formatTime(new Date(Number(seconds) * 1000))
    : '';
}

function formatTime(date: Date): string {
  if (!Number.isFinite(date.valueOf())) return '';
  return date.toLocaleString('en-CA', {
    dateStyle: 'short',
    timeStyle: 'long',
    hourCycle: 'h23',
  });
}

function readGit(args: string[]): string {
  try {
    return execFileSync('git', ['--no-replace-objects', ...args], {
      encoding: 'utf8',
      maxBuffer: 4096,
      timeout: 1000,
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

async function findVerifiedPushTime(
  entry: SyncReconciliation,
  context: TContext
): Promise<string> {
  const ref = `refs/heads/${entry.branch}`;
  try {
    // Activity is optional presentation evidence. Match the exact destination ref and SHA.
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${inspectionGithubRepo(context)}/activity`,
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '--raw-field',
        `ref=${ref}`,
        '--field',
        'per_page=20',
      ],
      { ...githubProcessOptions(), timeout: 2500, maxBuffer: 64 * 1024 }
    );
    const activity: unknown = JSON.parse(stdout);
    if (!Array.isArray(activity)) return '';
    const result = activity
      .map((row: unknown) => pushActivity.safeParse(row))
      .find(
        (row) =>
          row.success &&
          row.data.ref === ref &&
          row.data.after === entry.publishedHead
      );
    return result?.success ? formatTime(new Date(result.data.timestamp)) : '';
  } catch {
    return '';
  }
}
