import { githubProcessOptions, githubFailureKind } from './github_process';
import { execFile } from 'child_process';
import { z } from 'zod';
import { ExitFailedError } from '../errors';
import { GithubPr } from './github_pr';

const oid = z.string().regex(/^[a-f0-9]{40}$/);
const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
});
const reviewSchema = z.object({
  id: z.number().int().positive(),
  html_url: z.string().url(),
  pull_request_url: z.string().url(),
  user: userSchema,
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']),
  body: z.string(),
  commit_id: oid,
});
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
export type GithubReview = z.infer<typeof reviewSchema>;
export type GithubReviewUser = z.infer<typeof userSchema>;
type ExpectedReview = {
  readonly event: ReviewEvent;
  readonly body: string;
  readonly user: GithubReviewUser;
};

/** gh api has no --repo option; scope every endpoint and hostname explicitly. */
async function runReviewApi(
  endpoint: string,
  method: 'GET' | 'POST',
  options: { readonly payload?: string; readonly accept?: string } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'gh',
      [
        'api',
        endpoint,
        '--hostname',
        'github.com',
        '--method',
        method,
        '--header',
        `Accept: ${options.accept ?? 'application/vnd.github+json'}`,
        ...(options.payload === undefined ? [] : ['--input', '-']),
      ],
      githubProcessOptions(),
      (error, stdout, stderr) => {
        if (error) {
          const kind = {
            missing: 'GitHub CLI is missing',
            'rate-limit': 'GitHub rate limit exceeded',
            authentication: 'GitHub authentication or permission failure',
            network: 'GitHub network failure',
            request: 'GitHub request failed',
          }[githubFailureKind({ code: error.code, stderr })];
          reject(
            new ExitFailedError(
              `${kind}${stderr.trim() ? `: ${stderr.trim()}` : '.'}`
            )
          );
        } else resolve(stdout);
      }
    );
    child.stdin?.on('error', () => void 0);
    child.stdin?.end(options.payload);
  });
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new ExitFailedError('Malformed GitHub review response.');
  }
}

export async function getGithubPrDiff(
  pr: GithubPr,
  repo: string
): Promise<string> {
  return runReviewApi(`repos/${repo}/pulls/${pr.number}`, 'GET', {
    accept: 'application/vnd.github.diff',
  });
}

export async function getGithubReviewUser(): Promise<GithubReviewUser> {
  const result = userSchema.safeParse(
    parseJson(await runReviewApi('user', 'GET'))
  );
  if (!result.success)
    throw new ExitFailedError('Malformed authenticated GitHub user response.');
  return result.data;
}

export async function submitGithubReview(
  pr: GithubPr,
  repo: string,
  expected: ExpectedReview
): Promise<GithubReview> {
  const endpoint = `repos/${repo}/pulls/${pr.number}/reviews`;
  let submitted: GithubReview | undefined;
  try {
    submitted = validateReview(
      parseJson(
        await runReviewApi(endpoint, 'POST', {
          payload: JSON.stringify({
            event: expected.event,
            body: expected.body,
            commit_id: pr.headRefOid,
          }),
        })
      ),
      pr,
      { ...expected, repo }
    );
    const readback = validateReview(
      parseJson(await runReviewApi(`${endpoint}/${submitted.id}`, 'GET')),
      pr,
      { ...expected, repo }
    );
    if (readback.id !== submitted.id)
      throw new ExitFailedError('Review readback identity mismatch.');
    return readback;
  } catch (error: unknown) {
    throw new ExitFailedError(
      `Review ${
        submitted
          ? `#${submitted.id} retained but unverified`
          : 'submission failed or is uncertain'
      }: ${
        error instanceof Error ? error.message : 'unknown response'
      }. Do not automatically resubmit. Inspect ${
        submitted?.html_url ?? pr.url
      } and gh api --hostname github.com ${endpoint} before deliberate resubmission.`
    );
  }
}

function validateReview(
  raw: unknown,
  pr: GithubPr,
  expected: ExpectedReview & { readonly repo: string }
): GithubReview {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success)
    throw new ExitFailedError('Malformed or missing GitHub review readback.');
  const review = parsed.data;
  const state =
    expected.event === 'APPROVE'
      ? 'APPROVED'
      : expected.event === 'REQUEST_CHANGES'
      ? 'CHANGES_REQUESTED'
      : 'COMMENTED';
  if (
    review.html_url !== `${pr.url}#pullrequestreview-${review.id}` ||
    review.pull_request_url !==
      `https://api.github.com/repos/${expected.repo}/pulls/${pr.number}` ||
    review.user.id !== expected.user.id ||
    review.user.login !== expected.user.login ||
    review.state !== state ||
    review.body !== expected.body ||
    review.commit_id !== pr.headRefOid
  )
    throw new ExitFailedError(
      'Review identity, author, event, body or commit readback mismatch.'
    );
  return review;
}
