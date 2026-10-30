import { githubProcessOptions, githubFailureKind } from './github_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { TContext } from '../context';
import { ExitFailedError } from '../errors';
import { githubRepoSlug } from './github_repo';

const execFileAsync = promisify(execFile);
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const check = z.object({
  __typename: z.enum(['CheckRun', 'StatusContext']),
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
});
const prSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url(),
  title: z.string(),
  body: z.string(),
  author: z.object({ login: z.string().min(1) }).nullable(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefName: z.string().min(1),
  headRefOid: oid,
  baseRefName: z.string().min(1),
  baseRefOid: oid,
  headRepository: z
    .object({ name: z.string().min(1), nameWithOwner: z.string().optional() })
    .nullable(),
  headRepositoryOwner: z.object({ login: z.string().min(1) }).nullable(),
  isCrossRepository: z.boolean(),
  reviewDecision: z
    .enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', ''])
    .nullable()
    .optional(),
  mergeable: z
    .enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])
    .nullable()
    .optional(),
  mergeStateStatus: z.string().nullable().optional(),
  statusCheckRollup: z.array(check).nullable().optional(),
});
export type GithubPr = z.infer<typeof prSchema>;
const PR_FIELDS = Object.keys(prSchema.shape).join(',');

export function inspectionGithubRepo(context: TContext): string {
  if (context.repoConfig.getRepoHost().toLowerCase() !== 'github.com')
    throw new ExitFailedError(
      'PR workflows support github.com repositories only.'
    );
  const repo = githubRepoSlug(context);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new ExitFailedError('Invalid configured GitHub repository identity.');
  return repo;
}

/** Execute literal arguments with explicit repository/host and no incidental UI. */
export async function runGithubPrCommand(
  args: readonly string[],
  repo: string
): Promise<string> {
  try {
    const result = await execFileAsync(
      'gh',
      [...args, '--repo', `github.com/${repo}`],
      githubProcessOptions()
    );
    return result.stdout;
  } catch (error: unknown) {
    const kind = {
      missing: 'GitHub CLI is missing',
      'rate-limit': 'GitHub rate limit exceeded',
      authentication: 'GitHub authentication or permission failure',
      network: 'GitHub network failure',
      request: 'GitHub request failed',
    }[githubFailureKind(error)];
    throw new ExitFailedError(`${kind}; PR information is unavailable.`);
  }
}

/** Stored associations are lookup hints, never permission to relink another PR. */
export async function getGithubPr(
  branch: string,
  context: TContext
): Promise<GithubPr | undefined> {
  const repo = inspectionGithubRepo(context);
  const association = context.engine.getPrInfo(branch);
  const number = association?.number;
  if (
    number !== undefined &&
    (!z.number().int().positive().safeParse(number).success ||
      (association?.url !== undefined &&
        association.url.toLowerCase() !==
          `https://github.com/${repo}/pull/${number}`.toLowerCase()))
  )
    throw new ExitFailedError(
      'Stored pull request association does not match the configured repository and PR identity.'
    );
  const output = await runGithubPrCommand(
    number === undefined
      ? [
          'pr',
          'list',
          '--head',
          branch,
          '--state',
          'all',
          '--limit',
          '100',
          '--json',
          PR_FIELDS,
        ]
      : ['pr', 'view', String(number), '--json', PR_FIELDS],
    repo
  );
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new ExitFailedError('Malformed GitHub pull request response.');
  }
  const parsed = (
    number === undefined ? z.array(prSchema) : prSchema
  ).safeParse(raw);
  if (!parsed.success)
    throw new ExitFailedError('Malformed GitHub pull request response.');
  const prs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (prs.length > 1)
    throw new ExitFailedError(
      `Ambiguous pull request association for branch "${branch}".`
    );
  const pr = prs[0];
  if (!pr) return undefined;
  const expectedUrl = `https://github.com/${repo}/pull/${pr.number}`;
  if (
    pr.url.toLowerCase() !== expectedUrl.toLowerCase() ||
    (number !== undefined && pr.number !== number)
  )
    throw new ExitFailedError(
      'GitHub pull request repository or number identity mismatch.'
    );
  if (pr.headRefName !== branch)
    throw new ExitFailedError(
      `Stale pull request association: head branch does not match "${branch}".`
    );
  const headRepo = `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}`;
  if (pr.isCrossRepository || headRepo.toLowerCase() !== repo.toLowerCase())
    throw new ExitFailedError(
      'PR workflows require a same-repository GitHub head.'
    );
  if (
    pr.headRepository?.nameWithOwner !== undefined &&
    pr.headRepository.nameWithOwner.toLowerCase() !== repo.toLowerCase()
  )
    throw new ExitFailedError('GitHub head repository identity mismatch.');
  return pr;
}
