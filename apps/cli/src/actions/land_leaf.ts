import fs from 'fs';
import { z } from 'zod';
import { initContext, TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { getCacheLock } from '../lib/engine/cache_lock';
import { composeGit } from '../lib/git/git';
import { inspectLandAncestry } from '../lib/git/land_inspection';
import { withFrozenCommitGuard } from '../lib/git/frozen_commit';
import { deleteLandedRemote } from '../lib/git/land_cleanup';
import { getGithubPr, inspectionGithubRepo } from '../lib/api/github_pr';
import {
  getGithubLandPolicy,
  githubLandReadiness,
  readGithubLandApi,
} from '../lib/api/github_land_policy';
import { mergeGithubLandPr } from '../lib/api/github_land_merge';
import {
  current,
  owned,
  clearLandingProgress,
  LandingProgress,
  landingGit as git,
  landingRemoteIdentity,
  loadLandingProgress,
  saveLandingProgress,
} from '../lib/landing_progress';
import { LandPlan } from './land';
import { maintainLandingSurvivors } from './land_maintenance';
import { validateLocal } from './land_local';

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
  action: () => Promise<void>
): Promise<void> {
  const lock = getCacheLock();
  lock.lock();
  const interrupted = (): void => {
    lock.release();
    process.stderr.write(
      'Landing interrupted; completed or uncertain effects are retained. Run an land to reconcile.\n'
    );
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    await action();
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    lock.release();
  }
}

export async function startLandLeaf(
  plan: LandPlan,
  context: TContext
): Promise<void> {
  const member = plan.merges[0];
  if (!member.pr || (!member.remoteHead && !member.mergedResult))
    throw new ExitFailedError('Leaf publication identity is unavailable.');
  const record: LandingProgress = {
    owner: 'anthracite-landing',
    version: 1,
    directory: fs.realpathSync(git(['rev-parse', '--show-toplevel'])),
    gitDirectory: fs.realpathSync(git(['rev-parse', '--absolute-git-dir'])),
    repo: plan.repo,
    remote: context.repoConfig.getRemote(),
    ...landingRemoteIdentity(context.repoConfig.getRemote()),
    target: plan.target,
    trunk: plan.trunk,
    trunkHead: plan.trunkHead,
    checkout: plan.checkout,
    merges: plan.merges.map(capture),
    maintenance: plan.maintenance.map(capture),
    phase: 'prepared',
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
      number: member.pr?.number,
      url: member.pr?.url,
    };
  }
  validateIdentity(record, context);
  validateLocal(record, context);
  saveLandingProgress(record);
  await applyLandLeaf(record, context);
}

export async function resumeLandLeaf(
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
    await confirmedResult(record);
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
  await withLandingLock(async () => {
    const fresh = loadLandingProgress();
    if (JSON.stringify(fresh) !== JSON.stringify(record))
      throw new ExitFailedError('Landing recovery changed; inspect again.');
    await applyLandLeaf(record, context);
  });
}

async function applyLandLeaf(
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
            process.stdout.write(
              `Confirmed merged #${
                current(record).number
              } after uncertain response: ${reconciled}.\n`
            );
          }
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

function validateIdentity(record: LandingProgress, context: TContext): void {
  const identity = landingRemoteIdentity(context.repoConfig.getRemote());
  if (
    inspectionGithubRepo(context) !== record.repo ||
    context.engine.trunk !== record.trunk ||
    context.repoConfig.getRemote() !== record.remote ||
    identity.remoteUrlHash !== record.remoteUrlHash ||
    identity.pushUrlHash !== record.pushUrlHash
  )
    throw new ExitFailedError(
      'Landing repository/trunk/remote identity changed or split fetch/push remotes; recovery preserved.'
    );
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
  const blockers = githubLandReadiness(pr, policy);
  if (blockers.length)
    throw new ExitFailedError(`Fresh readiness blocked: ${blockers.join(' ')}`);
}
async function confirmedResult(
  record: LandingProgress
): Promise<string | undefined> {
  const pr = z
    .object({
      number: z.number(),
      merged: z.boolean(),
      state: z.string().optional(),
      merge_commit_sha: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .nullable(),
      head: z.object({
        ref: z.string(),
        sha: z.string(),
        repo: z.object({ full_name: z.string() }),
      }),
      base: z.object({
        ref: z.string(),
        repo: z.object({ full_name: z.string() }),
      }),
    })
    .parse(
      await readGithubLandApi(
        `repos/${record.repo}/pulls/${current(record).number}`
      )
    );
  const member = current(record);
  if (
    pr.number !== member.number ||
    pr.head.ref !== member.branch ||
    pr.head.sha !== owned(member).head ||
    pr.head.repo.full_name.toLowerCase() !== record.repo.toLowerCase() ||
    pr.base.ref !== record.trunk ||
    pr.base.repo.full_name.toLowerCase() !== record.repo.toLowerCase()
  )
    throw new ExitFailedError(
      'Merged PR identity does not match original target/head/repository.'
    );
  if (!pr.merged) {
    if (pr.state !== 'open')
      throw new ExitFailedError(
        'PR is closed-unmerged or its state is unavailable.'
      );
    return undefined;
  }
  const trunk = remoteHead(record, record.trunk);
  if (
    !pr.merge_commit_sha ||
    !trunk ||
    !inspectLandAncestry(pr.merge_commit_sha, trunk, {
      name: record.remote,
      trunk: record.trunk,
    })
  )
    throw new ExitFailedError(
      'Merged result is not confirmed in remote trunk.'
    );
  return pr.merge_commit_sha;
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
