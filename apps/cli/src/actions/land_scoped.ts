import {
  assertLandingRetryEvidence,
  hasCurrentLandingRetry,
  retainLandingRetry,
  retainLandingRetryOutcome,
} from '../lib/landing_retry';
import { confirmedLandingResult as confirmedResult } from '../lib/landing_confirmation';
import fs from 'fs';
import path from 'path';
import { releaseOwnedCacheLockFile } from '../lib/engine/owned_cache_lock';
import { initContext, TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { getCacheLock } from '../lib/engine/cache_lock';
import { composeGit } from '../lib/git/git';
import { inspectLandAncestry } from '../lib/git/land_inspection';
import { withFrozenCommitGuard } from '../lib/git/frozen_commit';
import { deleteLandedRemote } from '../lib/git/land_cleanup';
import { getGithubPr, GithubPr } from '../lib/api/github_pr';
import {
  getGithubLandPolicy,
  githubLandReadiness,
  githubLandReviewBlockers,
} from '../lib/api/github_land_policy';
import {
  mergeGithubLandPr,
  GithubLandMergeRejected,
} from '../lib/api/github_land_merge';
import {
  assertLandingProgressUnchanged,
  landingProgressPath,
  current,
  owned,
  clearLandingProgress,
  LandingProgress,
  landingGit as git,
  landingRemoteIdentity,
  landingSurvivors,
  isLandingPublicationDeferred,
  loadLandingProgress,
  saveLandingProgress,
} from '../lib/landing_progress';
import { LandPlan } from './land';
import { landingInspectionIsRunning } from '../lib/git/landing_inspection_process';
import { maintainLandingSurvivors } from './land_maintenance';
import { validateLocal } from './land_local';
import { validateLandingIdentity as validateIdentity } from '../lib/landing_identity';

const phaseOrder: LandingProgress['phase'][] = [
  'prepared',
  'merge-requested',
  'merged',
  'trunk-advanced',
  'remote-deleted',
  'local-deleted',
  'checkout-restored',
];

export async function withLandingLock(
  action: (
    identity: NonNullable<LandingProgress['cacheLock']>
  ) => Promise<void>,
  previous?: LandingProgress
): Promise<void> {
  const file = path.resolve(
    git(['rev-parse', '--git-common-dir']),
    '.graphite_cache_lock'
  );
  if (fs.lstatSync(file, { throwIfNoEntry: false })) {
    const identity = previous?.cacheLock;
    if (identity && fs.lstatSync(file).isFile()) {
      const bytes = fs.readFileSync(file, 'utf8');
      if (bytes === cacheLockBytes(identity) && deadPid(identity.pid))
        releaseOwnedCacheLockFile(file, identity.pid, bytes);
    }
    if (fs.lstatSync(file, { throwIfNoEntry: false }))
      throw new ExitFailedError(
        'Cache lock ownership or dead process is unproven; lock and landing recovery preserved. Inspect the original project before manual recovery.'
      );
  }
  const identity = { pid: process.pid, timestamp: Date.now() };
  if (previous)
    saveLandingProgress({ ...previous, cacheLock: identity }, previous);
  const lock = getCacheLock();
  lock.lock(identity.timestamp);
  const interrupted = (): void => {
    if (landingInspectionIsRunning()) return;
    releaseOwnedCacheLockFile(file, identity.pid, cacheLockBytes(identity));
    process.stderr.write(
      '⏸ Landing interrupted; reached local work and pending publication/base/footer obligations are retained in saved progress. Inspect an land --dry-run before explicit resumption.\n'
    );
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  };
  process.prependOnceListener('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    await action(identity);
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    releaseOwnedCacheLockFile(file, identity.pid, cacheLockBytes(identity));
  }
}

function cacheLockBytes(
  identity: NonNullable<LandingProgress['cacheLock']>
): string {
  return JSON.stringify(
    { timestamp: identity.timestamp, pid: identity.pid },
    null,
    2
  );
}

function deadPid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}

export async function startScopedLanding(
  plan: LandPlan,
  context: TContext,
  options: {
    readonly cacheLock: NonNullable<LandingProgress['cacheLock']>;
    readonly waitSeconds: number;
    readonly noVerify: boolean;
    readonly beforeFirstEffect?: () => Promise<void>;
  }
): Promise<void> {
  const member = plan.merges[0];
  if (!member.pr || (!member.remoteHead && !member.mergedResult))
    throw new ExitFailedError(
      'Scoped landing publication identity is unavailable.'
    );
  const record: LandingProgress = {
    owner: 'anthracite-landing',
    version: 2,
    directory: fs.realpathSync(git(['rev-parse', '--show-toplevel'])),
    gitDirectory: fs.realpathSync(git(['rev-parse', '--absolute-git-dir'])),
    repo: plan.repo,
    remote: context.repoConfig.getRemote(),
    ...landingRemoteIdentity(context.repoConfig.getRemote(), plan.repo),
    target: plan.target,
    trunk: plan.trunk,
    trunkHead: plan.trunkHead,
    checkout: plan.checkout,
    merges: plan.merges.map(capture),
    maintenance: plan.maintenance.map(capture),
    phase: 'prepared',
    cacheLock: options.cacheLock,
  };
  function capture(
    member: LandPlan['merges'][number]
  ): LandingProgress['merges'][number] {
    return {
      branch: member.branch,
      parent: member.parent,
      base: member.base,
      head: member.head,
      remoteHead:
        member.remoteHead ?? (member.mergedResult ? member.head : undefined),
      metadata: ref(`refs/branch-metadata/${member.branch}`),
      cleanupResult: member.mergedResult,
      number: member.pr?.number,
      url: member.pr?.url,
    };
  }
  validateIdentity(record, context);
  validateLocal(record, context);
  saveLandingProgress(record);
  await applyScopedLanding(record, context, {
    waitSeconds: options.waitSeconds,
    noVerify: options.noVerify,
    beforeFirstEffect: options.beforeFirstEffect,
  });
}

export async function resumeScopedLanding(
  record: LandingProgress,
  args: {
    readonly 'dry-run': boolean;
    readonly 'retry-unconfirmed'?: boolean;
    readonly yes: boolean;
    readonly verify?: boolean;
    readonly 'wait-timeout': number;
  },
  context: TContext
): Promise<void> {
  validateIdentity(record, context);
  assertLandingRetryEvidence(record);
  const inspection = await inspectPendingLanding(
    record,
    context,
    args['retry-unconfirmed'] === true
  );
  if (args['dry-run']) {
    if (inspection.blockers.length || inspection.pending.length)
      throw new ExitFailedError(
        'Pending landing preview blocked; recovery and repository preserved.'
      );
    return;
  }
  if (args['retry-unconfirmed'] && inspection.blockers.length)
    throw new ExitFailedError(
      'Pending landing blocked; no request sent; recovery preserved.'
    );
  if (!args.yes) {
    if (!context.canPrompt)
      throw new ExitFailedError(
        'Noninteractive landing requires --yes; recovery preserved.'
      );
    const answer = await context.prompts({
      type: 'confirm',
      name: 'confirmed',
      message: args['retry-unconfirmed']
        ? 'Send at most one new merge request despite the earlier unconfirmed outcome, then resume this disclosed landing plan?'
        : 'Resume this landing plan?',
      initial: false,
    });
    if (!answer.confirmed) return;
  }
  const original = fs.readFileSync(landingProgressPath(), 'utf8');
  assertLandingProgressUnchanged(record);
  let prepared = record;
  let createdAttempt: string | undefined;
  if (args['retry-unconfirmed'] && !(await confirmCurrentResult(record))) {
    validateLocal(record, context);
    validateMergeTrunk(record, owned(current(record)).base);
    await waitUntilReadyToMerge(record, context, args['wait-timeout']);
    prepared = retainLandingRetry(record, original);
    createdAttempt = prepared.retry?.attempt;
  }
  await withLandingLock(async (cacheLock) => {
    let fresh = loadLandingProgress();
    assertLandingProgressUnchanged({ ...record, cacheLock });
    if (!fresh)
      throw new ExitFailedError('Landing recovery changed; inspect again.');
    let retryAttempt: string | undefined;
    if (
      createdAttempt &&
      prepared.retry?.attempt === createdAttempt &&
      !(await confirmCurrentResult(fresh))
    ) {
      validateLocal(fresh, context);
      validateMergeTrunk(fresh, owned(current(fresh)).base);
      await waitUntilReadyToMerge(fresh, context, args['wait-timeout']);
      const next = { ...fresh, retry: prepared.retry };
      assertLandingRetryEvidence(next);
      saveLandingProgress(next, fresh);
      fresh = next;
      retryAttempt = createdAttempt;
    }
    await applyScopedLanding(fresh, context, {
      waitSeconds: args['wait-timeout'],
      noVerify: args.verify === false,
      retryAttempt,
    });
  }, record);
}

async function confirmCurrentResult(
  record: LandingProgress
): Promise<string | undefined> {
  const result = await confirmedResult(record);
  const member = current(record);
  if (
    [record.result, member.result, member.cleanupResult].some(
      (saved) => saved !== undefined && saved !== result
    )
  )
    throw new ExitFailedError(
      'Saved current merge result conflicts with fresh PR evidence; inspect recovery before retrying.'
    );
  return result;
}

type PendingLandingInspection = {
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly cleanupOnly: ReadonlySet<string>;
  readonly verification?: string;
  readonly retryUnconfirmed?: boolean;
};

function pendingPublicationDue(
  record: LandingProgress,
  cleanupOnly: ReadonlySet<string>
): string | undefined {
  if (record.version !== 2 || !cleanupOnly.has(current(record).branch))
    return undefined;
  const next = record.merges
    .slice((record.index ?? 0) + 1)
    .find(
      (member) =>
        !member.cleanupResult &&
        !member.result &&
        !cleanupOnly.has(member.branch)
    );
  return next &&
    (record.phase === 'prepared' ||
      record.phase === 'merge-requested' ||
      owned(next).head !== owned(next).remoteHead)
    ? next.branch
    : undefined;
}

function pendingPublicationDeferred(
  record: LandingProgress,
  branch: string,
  publicationDue?: string
): boolean {
  return (
    branch !== publicationDue && isLandingPublicationDeferred(record, branch)
  );
}

function printRetryProposal(
  record: LandingProgress,
  cleanupOnly: ReadonlySet<string>
): void {
  const member = current(record);
  if (
    !cleanupOnly.has(member.branch) &&
    (record.result || member.result || member.cleanupResult)
  ) {
    process.stdout.write(
      'Retry blocked: saved current result requires matching fresh confirmation.\n'
    );
    return;
  }
  process.stdout.write(
    cleanupOnly.has(member.branch)
      ? `No retry request needed: #${member.number} is confirmed merged.\n`
      : `🔁 Proposed retry: #${member.number} ${member.branch} (head ${
          owned(member).head
        })\n  One new request; earlier outcome remains unconfirmed. Application confirmation is still required.\n`
  );
}

function printPendingLanding(
  record: LandingProgress,
  context: TContext,
  inspection: PendingLandingInspection
): void {
  const remaining = record.merges.slice(record.index ?? 0);
  const publicationDue = pendingPublicationDue(record, inspection.cleanupOnly);
  if (inspection.blockers.length) {
    process.stdout.write('⛔ Cannot resume landing yet:\n');
    for (const blocker of inspection.blockers) {
      const member = remaining.find((merge) =>
        blocker.startsWith(`${merge.branch}: `)
      );
      process.stdout.write(
        `  - ${member?.number ? `#${member.number} ` : ''}${blocker}\n`
      );
    }
    process.stdout.write(
      `👉 Next: inspect the blockers in ${record.directory}, then preview again.\n\nOnce resolved, this would resume:\n`
    );
  }
  process.stdout.write(
    `⏸ Pending landing: ${record.repo}\nTarget: ${record.target} -> ${record.trunk}\nLocal ${record.trunk}: fast-forward after confirmed merges.\n`
  );
  if (inspection.retryUnconfirmed)
    printRetryProposal(record, inspection.cleanupOnly);
  if (inspection.verification)
    process.stdout.write(`Policy: ${inspection.verification}\n`);
  const completed = record.merges
    .slice(0, record.index ?? 0)
    .filter((member) => member.result);
  if (completed.length)
    process.stdout.write(
      `✅ Already merged: ${completed
        .map((member) => `#${member.number} ${member.branch}`)
        .join(', ')}\n`
    );
  if (record.replay)
    process.stdout.write(
      `Local replay incomplete: ${record.replay.pending.join(
        ', '
      )}; inspect owned recovery before remote work.\n`
    );
  process.stdout.write('\n🔀 Remaining PRs (bottom to top):\n');
  printRemainingMerges(record, inspection, publicationDue);
  const survivors = landingSurvivors(record);
  if (survivors.length) {
    process.stdout.write(
      `\n🔧 ${
        inspection.cleanupOnly.has(current(record).branch)
          ? 'After confirmed merge'
          : 'After merging'
      } #${current(record).number}: verify required branch maintenance.\n`
    );
    for (const member of survivors) {
      const expected = owned(member);
      const alsoMerges = remaining.some(
        (merge) => merge.branch === member.branch
      );
      process.stdout.write(
        `  Maintain: ${member.branch}${
          member.number ? ` #${member.number}` : ''
        } (${alsoMerges ? 'also a merge target' : 'not a merge target'})\n`
      );
      const effect = member.cleanupResult
        ? 'Verify metadata only; already landed.'
        : pendingPublicationDeferred(record, member.branch, publicationDue)
        ? 'Verify replay locally; defer push and PR base/footer updates until its merge preparation.'
        : `Verify replay; ${
            expected.remoteHead ? 'push existing branch' : 'keep local; no push'
          }; ${
            member.number
              ? `update existing PR #${member.number} base/footer`
              : 'no PR creation'
          }.`;
      process.stdout.write(`    ${effect}\n`);
    }
  }
  const checkout = record.merges.some(
    (member) => member.branch === record.checkout
  )
    ? record.trunk
    : `${record.checkout} if it survives, otherwise ${record.trunk}`;
  process.stdout.write(
    `\n🧹 Cleanup: ${remaining
      .map((member) => member.branch)
      .join(
        ', '
      )}\n  Verify landed-only local and leased remote cleanup.\nCheckout after completion: ${checkout}\n`
  );
  printPendingReadiness(record, inspection, publicationDue);
  process.stdout.write(
    'Use --debug for recovery phases, commit IDs and replay details.\n'
  );
  printPendingLandingDetails(record, context, {
    ...inspection,
    publicationDue,
  });
}

function pendingMergeAction(
  record: LandingProgress,
  member: LandingProgress['merges'][number],
  inspection: PendingLandingInspection
): string {
  const isCurrent = member.branch === current(record).branch;
  const saved =
    member.cleanupResult || member.result || (isCurrent && record.result);
  if (
    inspection.retryUnconfirmed &&
    isCurrent &&
    saved &&
    !inspection.cleanupOnly.has(member.branch)
  )
    return 'Unverified saved result';
  return saved || inspection.cleanupOnly.has(member.branch)
    ? 'Cleanup-only'
    : 'Merge';
}

function printRemainingMerges(
  record: LandingProgress,
  inspection: PendingLandingInspection,
  publicationDue?: string
): void {
  const remaining = record.merges.slice(record.index ?? 0);
  remaining.forEach((member, index) => {
    process.stdout.write(
      `  ${pendingMergeAction(record, member, inspection)} ${index + 1}: ${
        member.branch
      } #${member.number}${
        member.branch === publicationDue
          ? ' (publication due before its merge)'
          : pendingPublicationDeferred(record, member.branch, publicationDue)
          ? ' (publication deferred until its merge preparation)'
          : ''
      }\n`
    );
  });
}

function printPendingReadiness(
  record: LandingProgress,
  inspection: PendingLandingInspection,
  publicationDue?: string
): void {
  if (!inspection.blockers.length) {
    const due = record.merges.find(
      (member) => member.branch === publicationDue
    );
    process.stdout.write(
      due
        ? `⏳ Readiness: PENDING for #${due.number} ${due.branch}; complete immediate maintenance and fresh checks before merging.\n`
        : record.version === 2
        ? '✅ Readiness: READY for next merge only; deferred targets require publication and fresh checks.\n'
        : '✅ Readiness: READY for remaining work; checks repeat before every merge.\n'
    );
  }
  for (const warning of inspection.warnings)
    process.stdout.write(`⚠ ${warning}\n`);
}

function printPendingLandingDetails(
  record: LandingProgress,
  context: TContext,
  inspection: PendingLandingInspection & { readonly publicationDue?: string }
): void {
  const { publicationDue } = inspection;
  const write = (message: string): void =>
    context.splog.debug(message.trimEnd());
  write(
    `Pending landing: ${record.repo} trunk ${record.trunk} target ${
      record.target
    }; phase ${record.phase}.\nMerge: #${current(record).number} head ${
      owned(current(record)).head
    }\nCleanup: ${record.target}; original project ${record.directory}\n`
  );

  const remaining = record.merges.slice(record.index ?? 0);
  const survivors = landingSurvivors(record);
  write(
    `Remaining trunk maintenance: fast-forward ${record.trunk}; phase ${record.phase}.\n`
  );
  if (record.replay)
    write(
      `Local replay incomplete: ${record.replay.pending.join(
        ', '
      )}; resolve the owned local replay before remote work.\n`
    );
  for (const member of remaining)
    write(
      `${pendingMergeAction(record, member, inspection)}: ${member.branch} #${
        member.number
      }; reached head ${owned(member).head}; captured head ${member.head}\n`
    );
  for (const member of survivors) {
    const expected = owned(member);
    write(
      `Maintain: ${member.branch}; parent ${expected.parent} -> ${
        remaining.some((merge) => merge.branch === expected.parent)
          ? record.trunk
          : expected.parent
      }; replay base ${expected.base}; reached head ${expected.head}${
        member.cleanupResult
          ? '; metadata only, already landed'
          : '; verify required replay'
      }\n`
    );
    if (!member.cleanupResult) {
      write(
        `Push: ${member.branch}; ${
          pendingPublicationDeferred(record, member.branch, publicationDue)
            ? 'deferred until its merge preparation'
            : expected.remoteHead
            ? 'verify or update existing leased head'
            : 'remain unpublished'
        }\n`
      );
      write(
        `PR update: ${member.branch}; ${
          pendingPublicationDeferred(record, member.branch, publicationDue)
            ? 'base/dependency footer deferred with publication'
            : member.number
            ? `verify existing #${member.number} base/dependency footer`
            : 'no PR creation'
        }\n`
      );
    }
  }
  write(
    `Cleanup: ${remaining
      .map((member) => member.branch)
      .join(
        ', '
      )}; verify merged results and leased remote/local deletion; restore ${
      record.checkout
    }.\n`
  );
}

/** Inspect the captured remaining scope through the same identity/readiness adapters. */
async function inspectPendingLanding(
  record: LandingProgress,
  context: TContext,
  retryUnconfirmed = false
): Promise<{
  readonly blockers: readonly string[];
  readonly pending: readonly string[];
}> {
  const blockers: string[] = [];
  const pending: string[] = [];
  const warnings: string[] = [];
  const inspect = async (action: () => void | Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error: unknown) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  };
  const remaining = record.merges.slice(record.index ?? 0);
  const survivors = landingSurvivors(record);
  const cleanupOnly = new Set<string>();
  await inspect(() => validateLocal(record, context));
  await inspect(() => {
    validateRemoteTrunk(record);
  });
  let policy: LandPlan['policy'] | undefined;
  await inspect(async () => {
    policy = await getGithubLandPolicy(record.repo, record.trunk);
    blockers.push(...policy.blockers);
  });
  const fresh = initContext(context, composeGit(), { inspection: true });
  for (const member of [current(record), ...survivors])
    await inspect(async () => {
      const expected = owned(member);
      const published = remoteHead(record, member.branch);
      const isMerge = remaining.some((item) => item.branch === member.branch);
      const pr = await getGithubPr(member.branch, fresh);
      if (isMerge && !pr)
        throw new ExitFailedError(`${member.branch}: Missing pull request.`);
      if (pr && (pr.number !== member.number || pr.url !== member.url))
        throw new ExitFailedError(
          `${member.branch}: Fresh PR identity changed.`
        );
      const retryResult =
        retryUnconfirmed &&
        member.branch === current(record).branch &&
        pr?.state === 'OPEN'
          ? await confirmCurrentResult(record)
          : undefined;
      if ((pr?.state === 'MERGED' || retryResult) && isMerge) {
        const index = record.merges.findIndex(
          (item) => item.branch === member.branch
        );
        const result =
          retryResult ??
          (index === (record.index ?? 0)
            ? await confirmCurrentResult(record)
            : await confirmedResult({ ...record, index }));
        const captured =
          member.cleanupResult ??
          member.result ??
          (index === (record.index ?? 0) ? record.result : undefined);
        if (!result || (captured && captured !== result))
          throw new ExitFailedError(
            `${member.branch}: Merged result changed or unconfirmed.`
          );
        if (published && published !== expected.remoteHead)
          throw new ExitFailedError(
            `${member.branch}: Remote cleanup lease changed.`
          );
        cleanupOnly.add(member.branch);
        context.splog.debug(
          `Confirmed cleanup-only: ${member.branch}; result ${result}.`
        );
        return;
      }
      if (member.cleanupResult)
        throw new ExitFailedError(
          `${member.branch}: Cleanup-only merged identity changed.`
        );
      if (published !== expected.remoteHead && published !== expected.head)
        throw new ExitFailedError(
          `${member.branch}: Remote head changed outside saved progress.`
        );
      if (!expected.remoteHead && published)
        throw new ExitFailedError(
          `${member.branch}: Previously unpublished branch was published externally.`
        );
      if (
        pr &&
        (pr.state !== 'OPEN' ||
          pr.headRefOid !== published ||
          (pr.baseRefName !== expected.parent &&
            pr.baseRefName !== member.parent))
      )
        throw new ExitFailedError(
          `${member.branch}: Fresh PR state/head/base differs from saved publication.`
        );
      if (isMerge && pr)
        await inspectPendingReadiness(record, member, {
          pr,
          policy,
          blockers,
          pending,
          warnings,
          retryUnconfirmed,
          publicationPending:
            pendingPublicationDue(record, cleanupOnly) === member.branch,
        });
    });
  printPendingLanding(record, context, {
    blockers: [...blockers, ...pending],
    warnings,
    cleanupOnly,
    verification: policy?.verification,
    retryUnconfirmed,
  });
  return { blockers, pending };
}

async function inspectPendingReadiness(
  record: LandingProgress,
  member: LandingProgress['merges'][number],
  inspection: {
    readonly pr: GithubPr;
    readonly policy?: LandPlan['policy'];
    readonly blockers: string[];
    readonly pending: string[];
    readonly warnings: string[];
    readonly retryUnconfirmed?: boolean;
    readonly publicationPending: boolean;
  }
): Promise<void> {
  const { pr, policy, blockers, warnings } = inspection;
  if (
    member.branch === current(record).branch &&
    record.phase === 'merge-requested' &&
    !inspection.retryUnconfirmed
  )
    blockers.push(
      `${member.branch}: Previous merge request remains unconfirmed. An open PR alone does not authorize another request; preserve recovery and inspect the original failure.`
    );
  if (
    inspection.publicationPending ||
    isLandingPublicationDeferred(record, member.branch)
  ) {
    if (policy)
      blockers.push(
        ...githubLandReviewBlockers(pr, policy).map(
          (message) => `${member.branch}: ${message}`
        )
      );
    return;
  }
  if (member.branch === current(record).branch) {
    validateMergeTrunk(record, pr.baseRefOid);
    if (inspection.retryUnconfirmed)
      validateMergeTrunk(record, owned(member).base);
  }
  if (policy) {
    const readiness = await githubLandReadiness(pr, policy, record.repo);
    for (const warning of readiness.warnings)
      warnings.push(`#${pr.number}: ${warning}`);
    blockers.push(
      ...readiness.blockers.map((message) => `${member.branch}: ${message}`)
    );
    inspection.pending.push(
      ...readiness.pending.map((message) => `${member.branch}: ${message}`)
    );
  }
  if (remoteHead(record, member.branch) !== owned(member).head)
    blockers.push(
      `${member.branch}: Readiness for the reached local head is unknown until its mandatory push and fresh checks.`
    );
}

async function confirmAfterMergeFailure(
  record: LandingProgress,
  error: unknown
): Promise<string | undefined> {
  try {
    return await confirmCurrentResult(record);
  } catch (readbackError: unknown) {
    throw new ExitFailedError(
      `${
        error instanceof Error ? error.message : String(error)
      } Merge readback failed: ${
        readbackError instanceof Error
          ? readbackError.message
          : String(readbackError)
      }`
    );
  }
}

type ApplyLandingOptions = {
  readonly waitSeconds: number;
  readonly noVerify: boolean;
  readonly retryAttempt?: string;
  readonly beforeFirstEffect?: () => Promise<void>;
};

function initialReplayGuard(callback?: () => Promise<void>): {
  readonly validate: (record: LandingProgress) => Promise<void>;
  readonly invalidated: boolean;
} {
  let pending = callback;
  let invalidated = false;
  return {
    get invalidated() {
      return invalidated;
    },
    validate: async (record) => {
      if (!pending) return;
      try {
        await pending();
      } catch (error: unknown) {
        // Only this fresh invocation's unchanged record exists; no effect was sent.
        clearLandingProgress(record);
        invalidated = true;
        throw error;
      }
      pending = undefined;
    },
  };
}

async function applyScopedLanding(
  initial: LandingProgress,
  context: TContext,
  options: ApplyLandingOptions
): Promise<void> {
  let record = initial;
  const replayGuard = initialReplayGuard(options.beforeFirstEffect);
  let retryConsumed = false;
  let stage = 'reconciliation';
  const advance = (patch: Partial<LandingProgress>): void => {
    const phase =
      patch.phase &&
      phaseOrder.indexOf(patch.phase) > phaseOrder.indexOf(record.phase)
        ? patch.phase
        : record.phase;
    const next = { ...record, ...patch, phase };
    saveLandingProgress(next, record);
    record = next;
  };
  try {
    validateIdentity(record, context);
    validateLocal(record, context);
    while ((record.index ?? 0) < record.merges.length) {
      let result = await confirmCurrentResult(record);
      if (!result) {
        const canRetry =
          !retryConsumed &&
          !!options.retryAttempt &&
          record.retry?.attempt === options.retryAttempt &&
          hasCurrentLandingRetry(record);
        assertMergeCanProceed(record, canRetry);
        stage = 'readiness check';
        await waitUntilReadyToMerge(record, context, options.waitSeconds);
        validateLocal(record, context);
        stage = 'merge request';
        advance({ phase: 'merge-requested' });
        validateMergeEffect(record, context);
        const alreadyMerged = await confirmCurrentResult(record);
        await replayGuard.validate(record);
        validateMergeEffect(record, context);
        if (canRetry) retryConsumed = true;
        let response = alreadyMerged;
        try {
          if (!response) {
            stage = 'merge request attempt';
            response = await mergeGithubLandPr(
              record.repo,
              current(record).number,
              owned(current(record)).head
            );
          }
        } catch (error: unknown) {
          const reconciled = await confirmAfterMergeFailure(record, error);
          if (reconciled) {
            advance({ phase: 'merged', result: reconciled });
            printConfirmedMerge(record, context, true);
          } else record = retainRejectedMerge(record, error);
          throw error;
        }
        result = await confirmCurrentResult(record);
        if (result) advance({ result, phase: 'merged' });
        if (!result || result !== response)
          throw new ExitFailedError(
            'Merge response/result agreement is unconfirmed; later maintenance unattempted.'
          );
      }
      if (record.result && record.result !== result)
        throw new ExitFailedError(
          'Saved merge result changed; inspect recovery.'
        );
      await replayGuard.validate(record);
      advance({ result, phase: 'merged' });
      retainLandingRetryOutcome(record, 'confirmed', result);
      printConfirmedMerge(record, context);
      stage = 'trunk advance';
      advanceTrunk(record, context);
      advance({ phase: 'trunk-advanced' });
      stage = 'survivor maintenance';
      record = await maintainLandingSurvivors(
        record,
        context,
        options.noVerify
      );
      stage = 'remote cleanup';
      deleteRemote(record, context, options.noVerify);
      advance({ phase: 'remote-deleted' });
      stage = 'local cleanup';
      deleteLocal(record, context);
      advance({ phase: 'local-deleted' });
      if ((record.index ?? 0) + 1 >= record.merges.length) break;
      record = nextMerge(record, result);
    }
    stage = 'checkout restoration';
    restoreCheckout(record, context);
    advance({ phase: 'checkout-restored' });
    clearLandingProgress(record);
    process.stdout.write(
      `✅ Landing complete: ${record.target}; trunk advanced and landed refs/metadata cleaned.\n`
    );
  } catch (error: unknown) {
    failLandingExecution(record, error, {
      stage,
      retryConsumed,
      replayInvalidated: replayGuard.invalidated,
    });
  }
}

function assertMergeCanProceed(
  record: LandingProgress,
  canRetry: boolean
): void {
  if (record.phase !== 'prepared' && !canRetry)
    throw new ExitFailedError(
      'Merge remains uncertain or unconfirmed. No merge is repeated. An open PR alone does not establish that the earlier request was rejected; preserve recovery and inspect the original request failure.'
    );
}

function failLandingExecution(
  record: LandingProgress,
  error: unknown,
  execution: {
    readonly stage: string;
    readonly retryConsumed: boolean;
    readonly replayInvalidated: boolean;
  }
): never {
  if (execution.replayInvalidated) throw error;
  const failure =
    execution.stage.startsWith('merge request') && execution.retryConsumed
      ? retainRetryFailure(record, error)
      : error;
  throw landingFailure(record, execution.stage, failure);
}

function validateMergeEffect(record: LandingProgress, context: TContext): void {
  validateLocal(record, context);
  assertLandingProgressUnchanged(record);
  assertLandingRetryEvidence(record);
}

function retainRetryFailure(record: LandingProgress, error: unknown): unknown {
  try {
    retainLandingRetryOutcome(
      record,
      record.result
        ? 'confirmed'
        : error instanceof GithubLandMergeRejected
        ? 'rejected'
        : 'uncertain',
      error instanceof Error ? error.message : String(error)
    );
  } catch (evidenceError: unknown) {
    return new Error(
      `${
        error instanceof Error ? error.message : String(error)
      } Retry outcome evidence could not be retained: ${
        evidenceError instanceof Error
          ? evidenceError.message
          : String(evidenceError)
      }`
    );
  }
  return error;
}

function printConfirmedMerge(
  record: LandingProgress,
  context: TContext,
  afterUncertainResponse = false
): void {
  const number = current(record).number;
  process.stdout.write(
    `✅ Confirmed merged #${number}${
      afterUncertainResponse ? ' after uncertain response' : ''
    }.\n`
  );
  context.splog.debug(`Confirmed merge result #${number}: ${record.result}`);
}

function landingFailure(
  record: LandingProgress,
  stage: string,
  error: unknown
): ExitFailedError {
  return new ExitFailedError(
    `${
      stage === 'readiness check'
        ? `⏸ Landing paused before #${current(record).number}`
        : `Landing incomplete at ${stage}`
    }. ${record.merges
      .filter((member) => member.result)
      .map(
        (member) => `Confirmed merged #${member.number} (${member.result}); `
      )
      .join('')}${
      stage === 'readiness check'
        ? `No merge request sent for #${current(record).number};`
        : record.result
        ? `Confirmed merged #${current(record).number} (${record.result});`
        : error instanceof GithubLandMergeRejected
        ? `GitHub refused merge #${current(record).number};`
        : 'Merge unconfirmed or uncertain;'
    } ${
      stage === 'merge request attempt'
        ? 'New merge request attempted;'
        : ['reconciliation', 'readiness check', 'merge request'].includes(stage)
        ? 'No new merge request attempted;'
        : ''
    } later work unattempted. ${
      error instanceof Error ? error.message : String(error)
    } Recovery retained in ${record.directory}; ${
      record.phase === 'merge-requested' && !record.result
        ? `use an land ${record.target} --dry-run for read-only inspection or reconciliation of a completed merge. An unconfirmed request is not retried automatically; after inspecting the original uncertainty, explicitly authorize one verified new attempt with an land ${record.target} --retry-unconfirmed (add --yes for unattended confirmation).`
        : `resolve the reported blocker, preview with an land ${record.target} --dry-run, then explicitly resume with an land ${record.target} --yes.`
    }`
  );
}

/** Fresh verified OPEN plus explicit rejection permits only a later authorized run. */
function retainRejectedMerge(
  record: LandingProgress,
  error: unknown
): LandingProgress {
  if (
    !(error instanceof GithubLandMergeRejected) ||
    hasCurrentLandingRetry(record)
  )
    return record;
  const next = { ...record, phase: 'prepared' as const };
  saveLandingProgress(next, record);
  return next;
}

function restoreCheckout(record: LandingProgress, context: TContext): void {
  const destination = ref(`refs/heads/${record.checkout}`)
    ? record.checkout
    : record.trunk;
  composeGit().switchBranch(destination, { preserveIgnored: true });
  if (composeGit().getCurrentBranchName() !== destination)
    throw new ExitFailedError('Checkout restoration is unconfirmed.');
  validateLocal(record, context);
  if (
    record.merges.some(
      (member) =>
        ref(`refs/heads/${member.branch}`) ||
        ref(`refs/branch-metadata/${member.branch}`) ||
        remoteHead(record, member.branch)
    )
  )
    throw new ExitFailedError(
      'A landed ref was recreated during cleanup; preserved for inspection.'
    );
}

function advanceTrunk(record: LandingProgress, context: TContext): void {
  validateLocal(record, context);
  const remoteTrunk = remoteHead(record, record.trunk);
  if (
    !record.result ||
    !remoteTrunk ||
    !inspectLandAncestry(record.result, remoteTrunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'Confirmed merge is not reachable from remote trunk.'
    );
  const trunk = ref(`refs/heads/${record.trunk}`);
  if (
    !inspectLandAncestry(trunk, remoteTrunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'Local trunk is divergent; fast-forward required.'
    );
  git([
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    record.remote,
    `refs/heads/${record.trunk}`,
  ]);
  validateLocal(record, context);
  composeGit().switchBranch(record.trunk, { preserveIgnored: true });
  if (composeGit().getCurrentBranchName() !== record.trunk)
    throw new ExitFailedError(
      'Checkout changed before trunk advance; no undisclosed branch may be advanced.'
    );
  validateLocal(record, context);
  withFrozenCommitGuard(
    record.trunk,
    (prefix) => {
      git([
        ...prefix,
        'merge',
        '--ff-only',
        '--no-edit',
        '--no-overwrite-ignore',
        remoteTrunk,
      ]);
    },
    { allRefs: true, participants: [record.trunk] }
  );
  if (ref(`refs/heads/${record.trunk}`) !== remoteTrunk)
    throw new ExitFailedError('Trunk fast-forward was not confirmed.');
}

async function waitUntilReadyToMerge(
  record: LandingProgress,
  context: TContext,
  waitSeconds: number
): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000;
  let pending = await readyToMerge(record, context);
  const waiting = pending.length > 0;
  while (pending.length) {
    if (Date.now() >= deadline)
      throw new ExitFailedError(
        `Check wait timed out before #${current(record).number}: ${pending.join(
          ' '
        )}`
      );
    process.stdout.write(
      `⏳ Waiting for #${current(record).number} ${
        current(record).branch
      }: ${pending.join(' ')}\n`
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(5000, Math.max(0, deadline - Date.now())))
    );
    pending = await readyToMerge(record, context);
  }
  if (waiting)
    process.stdout.write(
      `✅ Checks passed for #${
        current(record).number
      }; readiness revalidated.\n`
    );
}

async function readyToMerge(
  record: LandingProgress,
  context: TContext
): Promise<readonly string[]> {
  const policy = await getGithubLandPolicy(record.repo, record.trunk);
  const pr = await getGithubPr(current(record).branch, context);
  validateLocal(record, context);
  if (pr?.state === 'MERGED' && (await confirmCurrentResult(record))) return [];
  if (
    !pr ||
    pr.state !== 'OPEN' ||
    pr.number !== current(record).number ||
    pr.url !== current(record).url ||
    pr.headRefOid !== owned(current(record)).head ||
    pr.baseRefName !== record.trunk ||
    remoteHead(record, current(record).branch) !==
      owned(current(record)).remoteHead
  )
    throw new ExitFailedError(
      'Fresh merge identity/base/head or remote lease changed.'
    );
  validateMergeTrunk(record, pr.baseRefOid);
  if (hasCurrentLandingRetry(record))
    validateMergeTrunk(record, owned(current(record)).base);
  const readiness = await githubLandReadiness(pr, policy, record.repo);
  for (const warning of readiness.warnings)
    process.stdout.write(`⚠ #${pr.number}: ${warning}\n`);
  if (readiness.blockers.length)
    throw new ExitFailedError(
      `Fresh readiness blocked: ${readiness.blockers.join(' ')}`
    );
  return readiness.pending;
}

/** A PR base snapshot may precede the live trunk after an independent merge. */
function validateRemoteTrunk(record: LandingProgress): string {
  const trunk = remoteHead(record, record.trunk);
  if (
    !trunk ||
    !inspectLandAncestry(ref(`refs/heads/${record.trunk}`), trunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'Remote trunk unavailable or local trunk divergent; fast-forward required.'
    );
  return trunk;
}
function validateMergeTrunk(record: LandingProgress, base: string): void {
  const trunk = validateRemoteTrunk(record);
  if (
    !inspectLandAncestry(base, trunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'PR base snapshot is not an ancestor of current remote trunk; inspect changed history.'
    );
}
function remoteHead(
  record: LandingProgress,
  branch: string
): string | undefined {
  return (
    git(['ls-remote', '--heads', record.remote, `refs/heads/${branch}`]).split(
      /\s+/
    )[0] || undefined
  );
}
function ref(name: string): string {
  const output = git(['for-each-ref', '--format=%(objectname)', name]);
  return output.split('\n')[0] || '';
}

function deleteRemote(
  record: LandingProgress,
  context: TContext,
  noVerify: boolean
): void {
  validateLocal(record, context);
  const published = remoteHead(record, current(record).branch);
  if (published && published !== owned(current(record)).remoteHead)
    throw new ExitFailedError(
      'Remote branch changed; preserved, explicit captured-OID lease refused cleanup.'
    );
  if (published && !owned(current(record)).remoteHead)
    throw new ExitFailedError('Captured remote lease unavailable.');
  if (published)
    deleteLandedRemote(record.remote, current(record).branch, {
      expectedHead: owned(current(record)).remoteHead ?? current(record).head,
      noVerify,
    });
  if (remoteHead(record, current(record).branch))
    throw new ExitFailedError(
      'Remote deletion is unconfirmed or branch was recreated; preserved.'
    );
}

function deleteLocal(record: LandingProgress, context: TContext): void {
  validateLocal(record, context);
  if (ref(`refs/heads/${current(record).branch}`))
    initContext(context, composeGit(), {
      inspection: true,
    }).engine.deleteLandedLeaf(current(record).branch, {
      head: owned(current(record)).head,
      metadata: owned(current(record)).metadata,
    });
  if (
    ref(`refs/heads/${current(record).branch}`) ||
    ref(`refs/branch-metadata/${current(record).branch}`)
  )
    throw new ExitFailedError('Local cleanup is incomplete.');
}

function nextMerge(record: LandingProgress, result: string): LandingProgress {
  const next = {
    ...record,
    index: (record.index ?? 0) + 1,
    phase: 'prepared' as const,
    result: undefined,
    merges: record.merges.map((member, index) =>
      index === (record.index ?? 0) ? { ...member, result } : member
    ),
  };
  saveLandingProgress(next, record);
  return next;
}
