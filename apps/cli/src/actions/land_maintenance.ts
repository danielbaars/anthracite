import { confirmedLandingResult } from '../lib/landing_confirmation';
import { TContext, initContext } from '../lib/context';
import { composeGit } from '../lib/git/git';
import { withFrozenPushGuard } from '../lib/git/frozen_push';
import {
  ExitFailedError,
  RebaseCheckoutError,
  RebaseMetadataError,
} from '../lib/errors';
import { getGithubPr, runGithubPrCommand } from '../lib/api/github_pr';
import {
  LandingProgress,
  landingGit as git,
  saveLandingProgress,
  current,
  owned,
  landingSurvivors,
} from '../lib/landing_progress';
import { createPrBodyFooter } from './create_pr_body_footer';
import { updatePrBodyFooter } from './submit/submit_action';
import { persistContinuation } from './persist_continuation';
import { validateLocal } from './land_local';

type Member = LandingProgress['merges'][number];
type Reached = NonNullable<Member['reached']>;

/** Only the disclosed affected survivors; never submit, sync, publish or discover PRs. */
export async function maintainLandingSurvivors(
  initial: LandingProgress,
  context: TContext
): Promise<LandingProgress> {
  // Reconfirm every captured cleanup-only identity/result before it influences
  // metadata or replay scope. MERGED in a cached PR alone never permits skipping.
  for (let index = initial.index ?? 0; index < initial.merges.length; index++) {
    const member = initial.merges[index];
    if (
      member.cleanupResult &&
      (await confirmedLandingResult({ ...initial, index })) !==
        member.cleanupResult
    )
      throw new ExitFailedError(
        'Cleanup-only merged identity/result changed; recovery preserved.'
      );
  }
  const replayed = replaySurvivors(initial, context);
  const associated = associatePrs(replayed, context);
  return await publishSurvivors(associated, context);
}
function participant(record: LandingProgress, branch: string): Member {
  const member = [...record.merges, ...record.maintenance].find(
    (item) => item.branch === branch
  );
  if (!member)
    throw new ExitFailedError(
      'Landing participant missing; recovery preserved.'
    );
  return member;
}
function updateReached(
  record: LandingProgress,
  branch: string,
  reached: Reached
): LandingProgress {
  const replace = (member: Member): Member =>
    member.branch === branch ? { ...member, reached } : member;
  const next = {
    ...record,
    merges: record.merges.map(replace),
    maintenance: record.maintenance.map(replace),
  };
  saveLandingProgress(next, record);
  return next;
}
function replaySurvivors(
  initial: LandingProgress,
  context: TContext
): LandingProgress {
  let record = initial;
  const survivors = landingSurvivors(record);
  const landedParents = new Set([
    current(record).branch,
    ...survivors
      .filter((member) => member.cleanupResult)
      .map((member) => member.branch),
  ]);
  for (const member of survivors) {
    validateLocal(record, context);
    const fresh = initContext(context, composeGit(), { inspection: true });
    const expected = owned(participant(record, member.branch));
    if (landedParents.has(expected.parent)) {
      fresh.engine.setParent(
        member.branch,
        record.trunk,
        survivors.map((item) => item.branch)
      );
      record = updateReached(record, member.branch, {
        ...expected,
        parent: record.trunk,
        metadata: git(['rev-parse', `refs/branch-metadata/${member.branch}`]),
      });
    }
  }
  // Continuation replays the whole pending queue, so every direct root must
  // already have its durable parent before the first possible conflict.
  const replayable = survivors.filter((member) => !member.cleanupResult);
  for (const member of replayable) {
    validateLocal(record, context);
    const fresh = initContext(context, composeGit(), { inspection: true });
    const before = owned(participant(record, member.branch));
    if (!fresh.engine.isBranchFixed(member.branch)) {
      const next = {
        ...record,
        replay: {
          pending: replayable
            .slice(replayable.indexOf(member))
            .map((item) => item.branch),
          onto: fresh.engine.getRevision(before.parent),
        },
      };
      saveLandingProgress(next, record);
      record = next;
      let result: ReturnType<TContext['engine']['restackBranch']>;
      try {
        result = fresh.engine.restackBranch(
          member.branch,
          survivors.map((item) => item.branch)
        );
      } catch (error: unknown) {
        if (
          error instanceof RebaseCheckoutError ||
          error instanceof RebaseMetadataError
        ) {
          const observed = initContext(context, composeGit(), {
            inspection: true,
          });
          record = updateReached(record, member.branch, {
            ...before,
            head: git(['rev-parse', `refs/heads/${member.branch}`]),
            base: observed.engine.getBaseRevision(member.branch),
            metadata: git([
              'rev-parse',
              `refs/branch-metadata/${member.branch}`,
            ]),
          });
          if (error instanceof RebaseCheckoutError) {
            const completed = { ...record, replay: undefined };
            saveLandingProgress(completed, record);
            record = completed;
          }
        }
        throw error;
      }
      if (result.result === 'REBASE_CONFLICT') {
        persistContinuation(
          {
            branchesToSync: [],
            branchesToRestack: replayable
              .slice(replayable.indexOf(member) + 1)
              .map((item) => item.branch),
            rebasedBranchBase: result.rebasedBranchBase,
          },
          fresh
        );
        throw new ExitFailedError(
          `Local replay conflict in ${member.branch}. Resolve and stage files, run an continue in ${record.directory}, then rerun an land ${record.target} --yes for remote maintenance.`
        );
      }
      record = updateReached(record, member.branch, {
        ...before,
        head: git(['rev-parse', `refs/heads/${member.branch}`]),
        base: fresh.engine.getBaseRevision(member.branch),
        metadata: git(['rev-parse', `refs/branch-metadata/${member.branch}`]),
      });
      const completed = { ...record, replay: undefined };
      saveLandingProgress(completed, record);
      record = completed;
    }
  }
  return record;
}
function associatePrs(
  initial: LandingProgress,
  context: TContext
): LandingProgress {
  let record = initial;
  const survivors = landingSurvivors(record);
  // Associate only already-existing participant PRs, so the existing footer builder
  // sees the complete surviving chain without submitting or creating any PR.
  for (const member of survivors) {
    if (!member.number || member.cleanupResult) continue;
    validateLocal(record, context);
    const fresh = initContext(context, composeGit(), { inspection: true });
    const expected = owned(participant(record, member.branch));
    fresh.engine.upsertPrInfo(member.branch, {
      number: member.number,
      url: member.url,
    });
    record = updateReached(record, member.branch, {
      ...expected,
      metadata: git(['rev-parse', `refs/branch-metadata/${member.branch}`]),
    });
  }
  return record;
}
async function publishSurvivors(
  initial: LandingProgress,
  context: TContext
): Promise<LandingProgress> {
  let record = initial;
  const survivors = landingSurvivors(record);
  for (const member of survivors) {
    if (member.cleanupResult) continue;
    try {
      validateLocal(record, context);
      const expected = owned(participant(record, member.branch));
      const published =
        git([
          'ls-remote',
          '--heads',
          record.remote,
          `refs/heads/${member.branch}`,
        ]).split(/\s+/)[0] || undefined;
      if (expected.remoteHead) {
        if (published !== expected.remoteHead && published !== expected.head)
          throw new ExitFailedError(
            `Remote head changed for ${member.branch}; captured-OID lease refused survivor push.`
          );
        if (published !== expected.head) {
          withFrozenPushGuard(
            { branch: member.branch, noVerify: false },
            (prefix) =>
              git([
                ...prefix,
                'push',
                record.remote,
                `--force-with-lease=refs/heads/${member.branch}:${expected.remoteHead}`,
                `refs/heads/${member.branch}:refs/heads/${member.branch}`,
              ])
          );
        }
        if (
          git([
            'ls-remote',
            '--heads',
            record.remote,
            `refs/heads/${member.branch}`,
          ]).split(/\s+/)[0] !== expected.head
        )
          throw new ExitFailedError(
            `Survivor push unconfirmed for ${member.branch}.`
          );
        record = updateReached(record, member.branch, {
          ...expected,
          remoteHead: expected.head,
        });
      } else if (published)
        throw new ExitFailedError(
          `Previously unpublished survivor ${member.branch} was published externally; inspect the saved scope.`
        );
      await updateSurvivorPr(record, member, context);
      process.stdout.write(
        `Maintained: ${member.branch}; head ${
          owned(participant(record, member.branch)).head
        }; ${member.number ? `existing PR #${member.number}` : 'no PR'}; ${
          member.remoteHead
            ? 'existing remote head verified'
            : 'remains unpublished'
        }.\n`
      );
    } catch (error: unknown) {
      throw new ExitFailedError(
        `Survivor maintenance incomplete for ${member.branch}. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return record;
}
async function updateSurvivorPr(
  record: LandingProgress,
  member: Member,
  context: TContext
): Promise<void> {
  if (!member.number) return;
  const expected = owned(participant(record, member.branch));
  validateLocal(record, context);
  const fresh = initContext(context, composeGit(), { inspection: true });
  const pr = await getGithubPr(member.branch, fresh);
  if (
    !pr ||
    pr.number !== member.number ||
    pr.url !== member.url ||
    pr.headRefOid !== expected.head ||
    pr.state !== 'OPEN'
  )
    throw new ExitFailedError(
      `Existing survivor PR identity changed for ${member.branch}.`
    );
  const body = updatePrBodyFooter(
    pr.body,
    createPrBodyFooter(fresh, member.branch)
  );
  if (pr.baseRefName !== expected.parent || pr.body !== body) {
    validateLocal(record, context);
    await runGithubPrCommand(
      [
        'pr',
        'edit',
        String(member.number),
        '--base',
        expected.parent,
        '--body',
        body,
      ],
      record.repo
    );
  }
  const verified = await getGithubPr(member.branch, fresh);
  if (
    !verified ||
    verified.number !== member.number ||
    verified.url !== member.url ||
    verified.headRefOid !== expected.head ||
    verified.baseRefName !== expected.parent ||
    verified.body !== body ||
    verified.title !== pr.title ||
    verified.isDraft !== pr.isDraft
  )
    throw new ExitFailedError(
      `Survivor PR base/footer update unconfirmed for ${member.branch}.`
    );
}
