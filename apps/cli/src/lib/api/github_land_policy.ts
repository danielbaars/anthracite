import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ExitFailedError } from '../errors';
import { GithubPr } from './github_pr';

const execFileAsync = promisify(execFile);

/** API endpoints carry repository identity; gh api does not accept --repo. */
export async function readGithubLandApi(endpoint: string): Promise<unknown> {
  try {
    const result = await execFileAsync(
      'gh',
      ['api', endpoint, '--hostname', 'github.com', '--method', 'GET'],
      {
        env: {
          ...process.env,
          GH_HOST: 'github.com',
          GH_PROMPT_DISABLED: '1',
          GH_PAGER: '',
          PAGER: '',
        },
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    return JSON.parse(result.stdout);
  } catch (error: unknown) {
    const failure = z
      .object({
        code: z.union([z.string(), z.number()]).optional(),
        stderr: z.string().optional(),
      })
      .safeParse(error);
    const detail = failure.success ? failure.data.stderr ?? '' : '';
    const reason =
      error instanceof SyntaxError
        ? 'malformed JSON'
        : failure.success && failure.data.code === 'ENOENT'
        ? 'GitHub CLI missing'
        : /rate.?limit|HTTP 429/i.test(detail)
        ? 'rate limit'
        : /auth|login|HTTP 401|HTTP 403|permission|forbidden|not accessible/i.test(
            detail
          )
        ? 'authentication or permission'
        : /network|connect|timeout|resolve host|TLS/i.test(detail)
        ? 'network failure'
        : 'request failed';
    throw new ExitFailedError(
      `GitHub identity or policy unavailable (${reason}): ${endpoint}. No readiness assumed.`
    );
  }
}

const requiredChecks = z.object({
  contexts: z.array(z.string()).optional(),
  checks: z
    .array(
      z.object({
        context: z.string(),
        app_id: z.number().nullable().optional(),
      })
    )
    .optional(),
});
const classicSchema = z.object({
  url: z.string().url(),
  required_pull_request_reviews: z
    .object({ required_approving_review_count: z.number().int().nonnegative() })
    .nullable()
    .optional(),
  required_status_checks: requiredChecks.nullable().optional(),
});
const ruleSchema = z.object({
  type: z.string(),
  parameters: z.unknown().optional(),
});
export type LandPolicy = {
  readonly reviews: number;
  readonly checks: readonly string[];
  readonly blockers: readonly string[];
};

export async function getGithubLandPolicy(
  repo: string,
  trunk: string
): Promise<LandPolicy> {
  const prefix = `repos/${repo}`;
  const repository = z
    .object({ full_name: z.string(), allow_rebase_merge: z.boolean() })
    .parse(await readGithubLandApi(prefix));
  if (repository.full_name.toLowerCase() !== repo.toLowerCase())
    throw new ExitFailedError('GitHub repository identity mismatch.');
  const blockers: string[] = repository.allow_rebase_merge
    ? []
    : ['Rebase merging is disabled.'];
  const branch = encodeURIComponent(trunk);
  const protection = z
    .object({ name: z.string(), protected: z.boolean() })
    .parse(await readGithubLandApi(`${prefix}/branches/${branch}`));
  if (protection.name !== trunk)
    throw new ExitFailedError('GitHub trunk identity mismatch.');
  const rules: z.infer<typeof ruleSchema>[] = [];
  // A full page is never evidence of completeness; keep reading until the short page.
  for (let page = 1; ; page++) {
    const values = z
      .array(ruleSchema)
      .parse(
        await readGithubLandApi(
          `${prefix}/rules/branches/${branch}?per_page=100&page=${page}`
        )
      );
    rules.push(...values);
    if (values.length < 100) break;
    if (page >= 1000)
      throw new ExitFailedError('GitHub policy pagination incomplete.');
  }
  let reviews = 0;
  const checks = new Set<string>();
  if (protection.protected) {
    // A 404 may mean insufficient Administration permission: it never proves absence.
    const classic = classicSchema.parse(
      await readGithubLandApi(`${prefix}/branches/${branch}/protection`)
    );
    reviews =
      classic.required_pull_request_reviews?.required_approving_review_count ??
      0;
    for (const name of classic.required_status_checks?.contexts ?? [])
      checks.add(name);
    for (const check of classic.required_status_checks?.checks ?? [])
      checks.add(check.context);
  }
  for (const rule of rules) {
    switch (rule.type) {
      case 'pull_request': {
        const parameters = z
          .object({
            required_approving_review_count: z.number().int().nonnegative(),
            allowed_merge_methods: z.array(z.string()).optional(),
          })
          .parse(rule.parameters);
        reviews = Math.max(reviews, parameters.required_approving_review_count);
        if (
          parameters.allowed_merge_methods &&
          !parameters.allowed_merge_methods.includes('rebase')
        )
          blockers.push('Applicable policy disables rebase merging.');
        break;
      }
      case 'required_status_checks': {
        const parameters = z
          .object({
            required_status_checks: z.array(z.object({ context: z.string() })),
          })
          .parse(rule.parameters);
        for (const check of parameters.required_status_checks)
          checks.add(check.context);
        break;
      }
      case 'merge_queue':
        blockers.push('Merge queue policy is unsupported.');
        break;
      case 'required_linear_history':
      case 'non_fast_forward':
      case 'deletion':
        break;
      default:
        blockers.push(`Unsupported active policy: ${rule.type}.`);
    }
  }
  return { reviews, checks: [...checks], blockers };
}

export function githubLandReadiness(
  pr: GithubPr,
  policy: LandPolicy
): string[] {
  const blockers = [...policy.blockers];
  if (pr.state !== 'OPEN') blockers.push(`PR is ${pr.state}, not open.`);
  if (pr.isDraft) blockers.push('PR is a draft.');
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    blockers.push('Changes requested.');
  if (
    pr.reviewDecision === 'REVIEW_REQUIRED' ||
    (policy.reviews > 0 && pr.reviewDecision !== 'APPROVED')
  )
    blockers.push('Required approvals missing.');
  if (pr.mergeable !== 'MERGEABLE')
    blockers.push(`Mergeability is ${pr.mergeable ?? 'UNKNOWN'}.`);
  if (pr.mergeStateStatus !== 'CLEAN')
    blockers.push(`GitHub readiness is ${pr.mergeStateStatus || 'UNKNOWN'}.`);
  if (!pr.statusCheckRollup) blockers.push('Checks unavailable.');
  const successful = new Set<string>();
  for (const check of pr.statusCheckRollup ?? []) {
    const name = check.name ?? check.context ?? 'unnamed';
    const state = check.conclusion || check.state || check.status || 'UNKNOWN';
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) successful.add(name);
    else blockers.push(`Check ${name}: ${state}.`);
  }
  for (const name of policy.checks)
    if (!successful.has(name))
      blockers.push(`Required check missing or not successful: ${name}.`);
  return blockers;
}
