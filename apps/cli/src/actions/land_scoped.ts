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
import { getGithubPr } from '../lib/api/github_pr';
import {
  getGithubLandPolicy,
  githubLandReadiness,
} from '../lib/api/github_land_policy';
import {
  mergeGithubLandPr,
  GithubLandMergeRejected,
} from '../lib/api/github_land_merge';
import {
  current,
  owned,
  clearLandingProgress,
  LandingProgress,
  landingGit as git,
  landingRemoteIdentity,
  landingSurvivors,
  loadLandingProgress,
  saveLandingProgress,
} from '../lib/landing_progress';
import { LandPlan } from './land';
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
    releaseOwnedCacheLockFile(file, identity.pid, cacheLockBytes(identity));
    process.stderr.write(
      'Landing interrupted; completed or uncertain effects are retained. Run an land to reconcile.\n'
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
  cacheLock: NonNullable<LandingProgress['cacheLock']>
): Promise<void> {
  const member = plan.merges[0];
  if (!member.pr || (!member.remoteHead && !member.mergedResult))
    throw new ExitFailedError(
      'Scoped landing publication identity is unavailable.'
    );
  const record: LandingProgress = {
    owner: 'anthracite-landing',
    version: 1,
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
    cacheLock,
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
  await applyScopedLanding(record, context);
}

export async function resumeScopedLanding(
  record: LandingProgress,
  args: { readonly 'dry-run': boolean; readonly yes: boolean },
  context: TContext
): Promise<void> {
  validateIdentity(record, context);
  process.stdout.write(
    `Pending landing: ${record.repo} trunk ${record.trunk} target ${
      record.target
    }; phase ${record.phase}.\nMerge: #${current(record).number} head ${
      owned(current(record)).head
    }\nCleanup: ${record.target}; original project ${record.directory}\n`
  );
  if (args['dry-run']) {
    await previewPendingLanding(record, context);
    return;
  }
  if (!args.yes) {
    if (!context.canPrompt)
      throw new ExitFailedError(
        'Noninteractive landing requires --yes; recovery preserved.'
      );
    const answer = await context.prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Resume this landing plan?',
      initial: false,
    });
    if (!answer.confirmed) return;
  }
  await withLandingLock(async (cacheLock) => {
    const fresh = loadLandingProgress();
    if (
      !fresh ||
      JSON.stringify(fresh) !== JSON.stringify({ ...record, cacheLock })
    )
      throw new ExitFailedError('Landing recovery changed; inspect again.');
    await applyScopedLanding(fresh, context);
  }, record);
}

function printPendingLanding(record: LandingProgress): void {
  const remaining = record.merges.slice(record.index ?? 0);
  const survivors = landingSurvivors(record);
  process.stdout.write(
    `Remaining trunk maintenance: fast-forward ${record.trunk}; phase ${record.phase}.\n`
  );
  if (record.replay)
    process.stdout.write(
      `Local replay incomplete: ${record.replay.pending.join(
        ', '
      )}; resolve the owned local replay before remote work.\n`
    );
  for (const member of remaining)
    process.stdout.write(
      `${member.cleanupResult ? 'Cleanup-only' : 'Merge'}: ${member.branch} #${
        member.number
      }; reached head ${owned(member).head}; captured head ${member.head}\n`
    );
  for (const member of survivors) {
    const expected = owned(member);
    process.stdout.write(
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
      process.stdout.write(
        `Push: ${member.branch}; ${
          expected.remoteHead
            ? 'verify or update existing leased head'
            : 'remain unpublished'
        }\n`
      );
      process.stdout.write(
        `PR update: ${member.branch}; ${
          member.number
            ? `verify existing #${member.number} base/dependency footer`
            : 'no PR creation'
        }\n`
      );
    }
  }
  process.stdout.write(
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
async function previewPendingLanding(
  record: LandingProgress,
  context: TContext
): Promise<void> {
  const blockers: string[] = [];
  const inspect = async (action: () => void | Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error: unknown) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  };
  const remaining = record.merges.slice(record.index ?? 0);
  const survivors = landingSurvivors(record);
  printPendingLanding(record);
  await inspect(() => validateLocal(record, context));
  await inspect(() => {
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
  });
  const policy = await getGithubLandPolicy(record.repo, record.trunk);
  blockers.push(...policy.blockers);
  const fresh = initContext(context, composeGit(), { inspection: true });
  const participants = [current(record), ...survivors];
  for (const member of participants)
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
      if (pr?.state === 'MERGED' && isMerge) {
        const index = record.merges.findIndex(
          (item) => item.branch === member.branch
        );
        const result = await confirmedResult({ ...record, index });
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
        process.stdout.write(
          `Confirmed cleanup-only: ${member.branch}; result ${result}.\n`
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
      if (isMerge && pr) {
        const readiness = await githubLandReadiness(pr, policy, record.repo);
        blockers.push(
          ...readiness.map((message) => `${member.branch}: ${message}`)
        );
        if (published !== expected.head)
          blockers.push(
            `${member.branch}: Readiness for the reached local head is unknown until its mandatory push and fresh checks.`
          );
      }
    });
  for (const blocker of blockers) process.stdout.write(`BLOCKED: ${blocker}\n`);
  if (blockers.length)
    throw new ExitFailedError(
      'Pending landing preview blocked; recovery and repository preserved.'
    );
  process.stdout.write(
    'Readiness: READY for remaining disclosed work; revalidation required before every effect.\n'
  );
}

async function applyScopedLanding(
  initial: LandingProgress,
  context: TContext
): Promise<void> {
  let record = initial;
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
      let result = await confirmedResult(record);
      if (!result) {
        if (record.phase !== 'prepared')
          throw new ExitFailedError(
            'Merge remains uncertain or unconfirmed. No merge is repeated; inspect GitHub and recovery.'
          );
        stage = 'merge request';
        await readyToMerge(record, context);
        validateLocal(record, context);
        advance({ phase: 'merge-requested' });
        let response: string;
        try {
          response = await mergeGithubLandPr(
            record.repo,
            current(record).number,
            owned(current(record)).head
          );
        } catch (error: unknown) {
          const reconciled = await confirmedResult(record);
          if (reconciled) {
            advance({ phase: 'merged', result: reconciled });
            const number = current(record).number;
            process.stdout.write(
              `Confirmed merged #${number} after uncertain response: ${reconciled}.\n`
            );
          } else record = retainRejectedMerge(record, error);
          throw error;
        }
        result = await confirmedResult(record);
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
      advance({ result, phase: 'merged' });
      process.stdout.write(
        `Confirmed merged #${current(record).number}: ${result}.\n`
      );
      stage = 'trunk advance';
      advanceTrunk(record, context);
      advance({ phase: 'trunk-advanced' });
      stage = 'survivor maintenance';
      record = await maintainLandingSurvivors(record, context);
      stage = 'remote cleanup';
      validateLocal(record, context);
      const published = remoteHead(record, current(record).branch);
      if (published && published !== owned(current(record)).remoteHead)
        throw new ExitFailedError(
          'Remote branch changed; preserved, explicit captured-OID lease refused cleanup.'
        );
      if (published && !owned(current(record)).remoteHead)
        throw new ExitFailedError('Captured remote lease unavailable.');
      if (published)
        deleteLandedRemote(
          record.remote,
          current(record).branch,
          owned(current(record)).remoteHead ?? current(record).head
        );
      if (remoteHead(record, current(record).branch))
        throw new ExitFailedError(
          'Remote deletion is unconfirmed or branch was recreated; preserved.'
        );
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
      `Landing complete: ${record.target}; trunk advanced and landed refs/metadata cleaned.\n`
    );
  } catch (error: unknown) {
    throw new ExitFailedError(
      `Landing incomplete at ${stage}. ${record.merges
        .filter((member) => member.result)
        .map(
          (member) => `Confirmed merged #${member.number} (${member.result}); `
        )
        .join('')}${
        record.result
          ? `Confirmed merged #${current(record).number} (${record.result});`
          : 'Merge unconfirmed or uncertain;'
      } later work unattempted. ${
        error instanceof Error ? error.message : String(error)
      } Recovery retained in ${record.directory}; rerun an land ${
        record.target
      } --yes.`
    );
  }
}

/** Fresh verified OPEN plus explicit rejection permits only a later authorized run. */
function retainRejectedMerge(
  record: LandingProgress,
  error: unknown
): LandingProgress {
  if (!(error instanceof GithubLandMergeRejected)) return record;
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

async function readyToMerge(
  record: LandingProgress,
  context: TContext
): Promise<void> {
  const policy = await getGithubLandPolicy(record.repo, record.trunk);
  const pr = await getGithubPr(current(record).branch, context);
  validateLocal(record, context);
  if (
    !pr ||
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
  const trunk = remoteHead(record, record.trunk);
  if (
    !trunk ||
    pr.baseRefOid !== trunk ||
    !inspectLandAncestry(ref(`refs/heads/${record.trunk}`), trunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'Fresh trunk/base changed or fast-forward is unavailable.'
    );
  const blockers = await githubLandReadiness(pr, policy, record.repo);
  if (blockers.length)
    throw new ExitFailedError(`Fresh readiness blocked: ${blockers.join(' ')}`);
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
