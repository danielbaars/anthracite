import {
  landingRemoteIdentity,
  loadLandingProgress,
} from '../lib/landing_progress';
import { resumeLandLeaf, startLandLeaf, withLandingLock } from './land_leaf';
import fs from 'fs';
import path from 'path';
import { initContext, TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { composeGit } from '../lib/git/git';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { runGitCommand } from '../lib/git/runner';
import {
  getGithubPr,
  GithubPr,
  inspectionGithubRepo,
} from '../lib/api/github_pr';
import {
  getGithubLandPolicy,
  githubLandReadiness,
} from '../lib/api/github_land_policy';
import { z } from 'zod';
import { readGithubLandApi } from '../lib/api/github_land_policy';
import { inspectLandAncestry } from '../lib/git/land_inspection';
import { selectPrBranch } from './pr_selection';

const gitRead = (args: string[]): string =>
  runGitCommand({
    args,
    onError: 'throw',
    resource: 'landingPreflight',
    options: { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  });
export type LandParticipant = {
  readonly branch: string;
  readonly parent: string;
  readonly head: string;
  readonly base: string;
  readonly remoteHead?: string;
  readonly pr?: GithubPr;
  readonly mergedResult?: string;
};
export type LandPlan = {
  readonly repo: string;
  readonly target: string;
  readonly trunk: string;
  readonly trunkHead: string;
  readonly remoteTrunk: string | undefined;
  readonly checkout: string;
  readonly policy: {
    readonly reviews: number;
    readonly checks: readonly string[];
    readonly blockers: readonly string[];
  };
  readonly merges: readonly LandParticipant[];
  readonly maintenance: readonly LandParticipant[];
  readonly blockers: readonly string[];
};

export async function planLand(
  target: string | undefined,
  context: TContext
): Promise<LandPlan> {
  if (!composeGit().getCurrentBranchName())
    throw new ExitFailedError(
      'Landing requires a physically checked-out branch.'
    );
  const branch = selectPrBranch(target, context);
  const repo = inspectionGithubRepo(context);
  const merges: string[] = [];
  let next = branch;
  while (!context.engine.isTrunk(next)) {
    if (merges.includes(next))
      throw new ExitFailedError('Tracked ancestry contains a cycle.');
    merges.unshift(next);
    next = context.engine.getParentPrecondition(next);
  }
  const affected: string[] = [];
  const visit = (name: string): void => {
    for (const child of context.engine.getChildrenPrecondition(name)) {
      if (!affected.includes(child)) {
        affected.push(child);
        visit(child);
      }
    }
  };
  visit(merges[0]);
  const maintenance = affected.filter((name) => !merges.includes(name));
  const blockers: string[] = [];
  const protect = (check: () => void): void => {
    try {
      check();
    } catch (error: unknown) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  };
  protect(() => assertNoGitOperation('land'));
  const continuation = path.resolve(
    gitRead(['rev-parse', '--git-path', '.gtcontinue'])
  );
  if (fs.existsSync(continuation))
    blockers.push(
      'Saved recovery exists. Inspect or finish the existing operation before landing.'
    );
  if (gitRead(['status', '--porcelain=v1', '--untracked-files=normal']))
    blockers.push('Clean index/worktree required, including untracked files.');
  const participants = [...merges, ...maintenance];
  for (const name of [context.engine.trunk, ...participants])
    protect(() => context.engine.assertBranchEditable(name));
  protect(() =>
    assertBranchesAvailableInWorktrees([context.engine.trunk, ...participants])
  );
  const remote = context.repoConfig.getRemote();
  protect(() => {
    landingRemoteIdentity(remote);
  });
  const remoteRefs = gitRead([
    'ls-remote',
    '--heads',
    remote,
    ...[context.engine.trunk, ...participants].map(
      (name) => `refs/heads/${name}`
    ),
  ]);
  const heads = new Map(
    remoteRefs
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [oid, ref] = line.split(/\s+/);
        return [ref.slice(11), oid];
      })
  );
  const remoteTrunk = heads.get(context.engine.trunk);
  if (!remoteTrunk) blockers.push('Remote trunk unavailable.');
  else
    protect(() => {
      if (
        !inspectLandAncestry(
          context.engine.getRevision(context.engine.trunk),
          remoteTrunk,
          { name: remote, trunk: context.engine.trunk }
        )
      )
        throw new ExitFailedError(
          'Local trunk is divergent; fast-forward required.'
        );
    });
  const policy = await getGithubLandPolicy(repo, context.engine.trunk);
  const records = await Promise.all(
    participants.map((name) =>
      inspectParticipant(name, context, {
        repo,
        merges,
        heads,
        remoteTrunk,
        policy,
        blockers,
      })
    )
  );

  return {
    repo,
    target: branch,
    trunk: context.engine.trunk,
    trunkHead: context.engine.getRevision(context.engine.trunk),
    remoteTrunk,
    checkout: composeGit().getCurrentBranchName() ?? '',
    policy,
    merges: records.filter((record) => merges.includes(record.branch)),
    maintenance: records.filter((record) =>
      maintenance.includes(record.branch)
    ),
    blockers,
  };
}

async function inspectParticipant(
  name: string,
  context: TContext,
  inspection: {
    readonly repo: string;
    readonly merges: readonly string[];
    readonly heads: ReadonlyMap<string, string>;
    readonly remoteTrunk?: string;
    readonly policy: LandPlan['policy'];
    readonly blockers: string[];
  }
): Promise<LandParticipant> {
  const { repo, merges, heads, remoteTrunk, policy, blockers } = inspection;
  const remote = context.repoConfig.getRemote();
  const pr = await getGithubPr(name, context);
  const head = gitRead(['rev-parse', `refs/heads/${name}`]);
  let mergedResult: string | undefined;
  const remoteHead = heads.get(name);
  if (remoteHead && remoteHead !== head)
    blockers.push(
      `${name}: published head differs from local head (divergent or unpublished commits).`
    );
  if (pr && !remoteHead && pr.state !== 'MERGED')
    blockers.push(`${name}: Published PR remote head missing.`);
  if (pr && pr.headRefOid !== head)
    blockers.push(`${name}: PR head differs from local head.`);
  if (merges.includes(name)) {
    if (!pr) blockers.push(`${name}: Missing pull request.`);
    else {
      if (pr.state === 'MERGED') {
        const merged = z
          .object({
            number: z.number(),
            merged: z.literal(true),
            merge_commit_sha: z.string().regex(/^[a-f0-9]{40}$/),
            head: z.object({ ref: z.string(), sha: z.string() }),
            base: z.object({
              ref: z.string(),
              repo: z.object({ full_name: z.string() }),
            }),
          })
          .parse(await readGithubLandApi(`repos/${repo}/pulls/${pr.number}`));
        if (
          merged.number !== pr.number ||
          merged.head.ref !== name ||
          merged.head.sha !== head ||
          merged.base.ref !== context.engine.trunk ||
          merged.base.repo.full_name.toLowerCase() !== repo.toLowerCase() ||
          !remoteTrunk ||
          !inspectLandAncestry(merged.merge_commit_sha, remoteTrunk, {
            name: remote,
            trunk: context.engine.trunk,
          })
        )
          blockers.push(
            `${name}: Already-merged identity/result is unverified.`
          );
        else mergedResult = merged.merge_commit_sha;
      } else {
        if (!remoteHead)
          blockers.push(`${name}: Published remote head missing.`);
        if (pr.baseRefName !== context.engine.getParentPrecondition(name))
          blockers.push(`${name}: PR base does not match tracked parent.`);
        blockers.push(
          ...githubLandReadiness(pr, policy).map(
            (message) => `${name}: ${message}`
          )
        );
      }
    }
  }
  return {
    branch: name,
    parent: context.engine.getParentPrecondition(name),
    base: context.engine.getBaseRevision(name),
    head,
    remoteHead,
    pr,
    mergedResult,
  };
}

export function printLandPlan(plan: LandPlan): void {
  if (plan.policy.blockers.length)
    process.stdout.write(
      'Policy: unsupported or blocked; no readiness assumed.\n'
    );
  else if (plan.policy.reviews === 0 && plan.policy.checks.length === 0)
    process.stdout.write(
      'Policy: No required reviews or checks (complete rules and classic protection evidence).\n'
    );
  else
    process.stdout.write(
      `Policy: ${plan.policy.reviews} required approval(s); required checks: ${
        plan.policy.checks.join(', ') || 'none'
      }\n`
    );
  process.stdout.write(
    `Landing plan: ${plan.repo} trunk ${plan.trunk} target ${
      plan.target
    }\nTrunk: ${plan.trunkHead} -> ${
      plan.remoteTrunk ?? 'UNKNOWN'
    } (fast-forward only)\n`
  );
  plan.merges.forEach((member, index) =>
    process.stdout.write(
      `${member.mergedResult ? 'Cleanup-only' : 'Merge'} ${index + 1}: ${
        member.branch
      } #${member.pr?.number ?? '?'} ${member.pr?.url ?? ''}\n  Head: ${
        member.head
      }\n  Base: ${member.pr?.baseRefName ?? member.parent} ${
        member.pr?.baseRefOid ?? member.base
      } (tracked parent ${member.parent}; replay base ${
        member.base
      })\n  State: ${member.pr?.state ?? 'MISSING'}; draft ${
        member.pr?.isDraft ?? 'UNKNOWN'
      }; readiness ${member.pr?.mergeStateStatus || 'UNKNOWN'}${
        member.mergedResult
          ? `; verified merged result ${member.mergedResult}`
          : ''
      }\n  ${
        member.parent !== plan.trunk && !member.mergedResult
          ? 'Before merge: replay own commits onto trunk; update existing remote head and PR base/footer; recheck readiness'
          : 'Verify trunk base/head immediately before effect'
      }\n`
    )
  );
  for (const member of plan.maintenance)
    process.stdout.write(
      `Maintain: ${member.branch}\n  Reparent to ${
        plan.merges.some((merge) => merge.branch === member.parent)
          ? plan.trunk
          : member.parent
      }; replay from ${member.parent} (${member.base}); head ${
        member.head
      }\n  ${
        member.remoteHead
          ? `Update existing remote head ${member.remoteHead}`
          : 'Unpublished: remain unpublished'
      }\n  ${
        member.pr
          ? `Update existing PR #${member.pr.number} base/dependency footer; preserve user fields`
          : 'No PR: do not create one'
      }\n`
    );
  process.stdout.write(
    `Cleanup: ${plan.merges
      .map((member) => member.branch)
      .join(
        ', '
      )} (confirmed landed local metadata/refs and unchanged remote heads only)\n`
  );
  for (const blocker of plan.blockers)
    process.stdout.write(`BLOCKED: ${blocker}\n`);
  if (!plan.blockers.length)
    process.stdout.write('Readiness: READY for disclosed plan.\n');
}

export async function land(
  target: string | undefined,
  args: { readonly 'dry-run': boolean; readonly yes: boolean },
  context: TContext
): Promise<void> {
  const pending = loadLandingProgress();
  if (pending) {
    if (target !== undefined && target !== pending.target)
      throw new ExitFailedError(
        'A different landing target is pending; original recovery preserved.'
      );
    await resumeLandLeaf(pending, args, context);
    return;
  }
  const plan = await planLand(target, context);
  printLandPlan(plan);
  if (plan.blockers.length)
    throw new ExitFailedError('Landing preflight blocked; no changes made.');
  if (args['dry-run']) return;
  if (!args.yes) {
    if (!context.canPrompt)
      throw new ExitFailedError(
        'Noninteractive landing requires --yes; no changes made.'
      );
    const answer = await context.prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Apply this landing plan?',
      initial: false,
    });
    if (!answer.confirmed) {
      process.stdout.write('Landing cancelled; no changes made.\n');
      return;
    }
  }
  const freshContext = initContext(context, composeGit(), { inspection: true });
  const fresh = await planLand(target, freshContext);
  if (JSON.stringify(fresh) !== JSON.stringify(plan) || fresh.blockers.length)
    throw new ExitFailedError(
      'Landing scope/readiness changed after confirmation; preview again. No changes made.'
    );
  const participants = [...fresh.merges, ...fresh.maintenance];
  if (
    [fresh.trunk, ...participants.map((member) => member.branch)].some(
      (parent) =>
        participants.filter((member) => member.parent === parent).length > 1
    )
  )
    throw new ExitFailedError(
      'Fanout landing application is not implemented for this scope yet; no changes made. Use --dry-run.'
    );
  await withLandingLock(async () => {
    const lockedContext = initContext(context, composeGit(), {
      inspection: true,
    });
    const locked = await planLand(target, lockedContext);
    if (
      JSON.stringify(locked) !== JSON.stringify(fresh) ||
      locked.blockers.length
    )
      throw new ExitFailedError(
        'Landing scope/readiness changed under lock; preview again. No changes made.'
      );
    await startLandLeaf(locked, lockedContext);
  });
}
