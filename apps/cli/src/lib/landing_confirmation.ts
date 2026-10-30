import { z } from 'zod';
import { ExitFailedError } from './errors';
import { readGithubLandApi } from './api/github_land_policy';
import { inspectLandAncestry } from './git/land_inspection';
import {
  LandingProgress,
  landingGit as git,
  current,
  owned,
  assertLandingRemoteIdentity,
} from './landing_progress';

export async function confirmedLandingResult(
  record: LandingProgress
): Promise<string | undefined> {
  assertLandingRemoteIdentity(record);
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
