import { githubProcessOptions, githubFailureKind } from './github_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ExitFailedError } from '../errors';
import { GithubPr } from './github_pr';

const execFileAsync = promisify(execFile);

class ClassicProtectionNotFound extends ExitFailedError {}
class RulesPlanRestricted extends ExitFailedError {}

const PLAN_RESTRICTION =
  'Upgrade to GitHub Pro or make this repository public to enable this feature.';

function isRulesPlanRestricted(error: unknown): boolean {
  const failure = z
    .object({ code: z.literal(1), stdout: z.string(), stderr: z.string() })
    .safeParse(error);
  if (!failure.success) return false;
  try {
    const body = z
      .object({
        message: z.literal(PLAN_RESTRICTION),
        documentation_url: z.literal(
          'https://docs.github.com/rest/repos/rules#get-rules-for-a-branch'
        ),
        status: z.literal('403'),
      })
      .safeParse(JSON.parse(failure.data.stdout));
    return (
      body.success &&
      [
        `gh: ${PLAN_RESTRICTION} (HTTP 403)`,
        `gh: ${PLAN_RESTRICTION} (HTTP 403)\n`,
        `gh: ${PLAN_RESTRICTION} (HTTP 403)\r\n`,
      ].includes(failure.data.stderr)
    );
  } catch {
    return false;
  }
}

function isClassicProtectionNotFound(error: unknown): boolean {
  const failure = z
    .object({ stdout: z.string(), stderr: z.string() })
    .safeParse(error);
  if (!failure.success) return false;
  try {
    const body = z
      .object({
        message: z.literal('Branch not protected'),
        status: z.literal('404'),
      })
      .safeParse(JSON.parse(failure.data.stdout));
    return (
      body.success &&
      /^gh: Branch not protected \(HTTP 404\)\r?\n?$/.test(failure.data.stderr)
    );
  } catch {
    return false;
  }
}

/** API endpoints carry repository identity; gh api does not accept --repo. */
export async function readGithubLandApi(endpoint: string): Promise<unknown> {
  try {
    const result = await execFileAsync(
      'gh',
      ['api', endpoint, '--hostname', 'github.com', '--method', 'GET'],
      githubProcessOptions()
    );
    return JSON.parse(result.stdout);
  } catch (error: unknown) {
    if (
      /^repos\/[^/]+\/[^/]+\/rules\/branches\/[^/?]+\?per_page=100&page=1$/.test(
        endpoint
      ) &&
      isRulesPlanRestricted(error)
    )
      throw new RulesPlanRestricted(
        'GitHub applicable-rules REST access is restricted by subscription; independent policy verification is required. No readiness assumed.'
      );
    const reason =
      error instanceof SyntaxError
        ? 'malformed JSON'
        : {
            missing: 'GitHub CLI missing',
            'rate-limit': 'rate limit',
            authentication: 'authentication or permission',
            network: 'network failure',
            request: 'request failed',
          }[githubFailureKind(error)];
    const Failure = isClassicProtectionNotFound(error)
      ? ClassicProtectionNotFound
      : ExitFailedError;
    throw new Failure(
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
        app_id: z.number().int().nullable().optional(),
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

const privatePlanEvidenceSchema = z.object({
  errors: z.array(z.unknown()).max(0).optional(),
  data: z.object({
    repository: z.object({
      nameWithOwner: z.string(),
      isPrivate: z.literal(true),
      viewerPermission: z.literal('ADMIN'),
      ref: z.object({
        name: z.string(),
        branchProtectionRule: z.null(),
      }),
      rulesets: z.object({
        totalCount: z.number().int().nonnegative(),
        nodes: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .refine((id) => id.trim().length > 0),
              enforcement: z.string(),
            })
          )
          .max(100),
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
      }),
    }),
  }),
});

async function verifyDisabledPrivatePlanPolicy(
  repo: string,
  trunk: string
): Promise<void> {
  const [owner, name] = repo.split('/');
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | undefined;
  let total: number | undefined;
  try {
    // Bound service traversal even when each page appears to make progress.
    for (let page = 0; page < 100; page++) {
      const result = await execFileAsync(
        'gh',
        [
          'api',
          'graphql',
          '--hostname',
          'github.com',
          '--method',
          'POST',
          '-f',
          'query=query($owner: String!, $name: String!, $ref: String!, $after: String) { repository(owner: $owner, name: $name) { nameWithOwner isPrivate viewerPermission ref(qualifiedName: $ref) { name branchProtectionRule { id } } rulesets(first: 100, after: $after, includeParents: true) { totalCount nodes { id enforcement } pageInfo { hasNextPage endCursor } } } }',
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
          '-f',
          `ref=refs/heads/${trunk}`,
          ...(after === undefined ? [] : ['-f', `after=${after}`]),
        ],
        githubProcessOptions()
      );
      const evidence = privatePlanEvidenceSchema.parse(
        JSON.parse(result.stdout)
      );
      const repository = evidence.data.repository;
      if (
        repository.nameWithOwner.toLowerCase() !== repo.toLowerCase() ||
        repository.ref.name !== trunk
      )
        throw new ExitFailedError(
          'Independent policy repository or trunk identity does not match.'
        );
      const inventory = repository.rulesets;
      if (total !== undefined && total !== inventory.totalCount)
        throw new ExitFailedError(
          'Independent policy inventory total changed during pagination.'
        );
      total = inventory.totalCount;
      for (const node of inventory.nodes) {
        if (ids.has(node.id))
          throw new ExitFailedError(
            'Independent policy inventory contains duplicate ruleset IDs.'
          );
        ids.add(node.id);
        if (node.enforcement !== 'DISABLED')
          throw new ExitFailedError(
            node.enforcement === 'EVALUATE'
              ? 'Evaluate-mode rulesets are outside the supported disabled-only policy proof.'
              : 'Independent policy inventory contains a non-disabled or unknown ruleset enforcement state.'
          );
      }
      if (ids.size > total)
        throw new ExitFailedError(
          'Independent policy inventory exceeds its declared total.'
        );
      if (!inventory.pageInfo.hasNextPage) {
        if (ids.size !== total)
          throw new ExitFailedError(
            'Independent policy inventory is incomplete.'
          );
        return;
      }
      const cursor = inventory.pageInfo.endCursor;
      if (
        !inventory.nodes.length ||
        ids.size >= total ||
        !cursor ||
        !cursor.trim() ||
        cursors.has(cursor)
      )
        throw new ExitFailedError(
          'Independent policy pagination is incomplete or not advancing.'
        );
      cursors.add(cursor);
      after = cursor;
    }
    throw new ExitFailedError('Independent policy pagination limit exceeded.');
  } catch (error: unknown) {
    const reason =
      error instanceof ExitFailedError
        ? error.message
        : error instanceof z.ZodError
        ? `Invalid independent policy evidence at ${[
            ...new Set(
              error.issues.map(
                (issue) => issue.path.map(String).join('.') || 'response'
              )
            ),
          ].join(', ')}.`
        : 'Independent administrator-visible policy lookup is unavailable.';
    throw new ExitFailedError(
      `Plan-restricted GitHub policy unverified: ${reason} No readiness assumed.`
    );
  }
}

async function readApplicableLandRules(
  repo: string,
  trunk: string,
  canVerifyPlanAbsence: boolean
): Promise<{
  readonly rules: readonly z.infer<typeof ruleSchema>[];
  readonly verification?: string;
}> {
  const rules: z.infer<typeof ruleSchema>[] = [];
  for (let page = 1; ; page++) {
    let values: z.infer<typeof ruleSchema>[];
    try {
      values = z
        .array(ruleSchema)
        .parse(
          await readGithubLandApi(
            `repos/${repo}/rules/branches/${encodeURIComponent(
              trunk
            )}?per_page=100&page=${page}`
          )
        );
    } catch (error: unknown) {
      if (!(error instanceof RulesPlanRestricted) || page !== 1) throw error;
      if (!canVerifyPlanAbsence)
        throw new ExitFailedError(
          'Plan-restricted GitHub policy unverified: matching private administrator access and an unprotected trunk REST response are required. No readiness assumed.'
        );
      await verifyDisabledPrivatePlanPolicy(repo, trunk);
      return {
        rules: [],
        verification:
          'Independently verified despite plan-restricted REST access.',
      };
    }
    rules.push(...values);
    // A full page is never evidence of completeness.
    if (values.length < 100) return { rules };
    if (page >= 1000)
      throw new ExitFailedError('GitHub policy pagination incomplete.');
  }
}

async function verifyClassicProtectionAbsent(
  repo: string,
  trunk: string
): Promise<void> {
  const [owner, name] = repo.split('/');
  try {
    const result = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '--hostname',
        'github.com',
        '--method',
        'POST',
        '-f',
        'query=query($owner: String!, $name: String!, $ref: String!) { repository(owner: $owner, name: $name) { nameWithOwner viewerPermission ref(qualifiedName: $ref) { name branchProtectionRule { id } } } }',
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-f',
        `ref=refs/heads/${trunk}`,
      ],
      githubProcessOptions()
    );
    const evidence = z
      .object({
        errors: z.array(z.unknown()).max(0).optional(),
        data: z.object({
          repository: z.object({
            nameWithOwner: z.string(),
            viewerPermission: z.literal('ADMIN'),
            ref: z.object({ name: z.string(), branchProtectionRule: z.null() }),
          }),
        }),
      })
      .parse(JSON.parse(result.stdout));
    if (
      evidence.data.repository.nameWithOwner.toLowerCase() !==
        repo.toLowerCase() ||
      evidence.data.repository.ref.name !== trunk
    )
      throw new Error('Classic protection evidence identity mismatch.');
  } catch {
    throw new ExitFailedError(
      'Classic protection absence unverified: matching administrator-visible branch evidence required. No readiness assumed.'
    );
  }
}

async function readClassicLandPolicy(
  repo: string,
  trunk: string,
  hasRules: boolean
): Promise<z.infer<typeof classicSchema> | undefined> {
  try {
    return classicSchema.parse(
      await readGithubLandApi(
        `repos/${repo}/branches/${encodeURIComponent(trunk)}/protection`
      )
    );
  } catch (error: unknown) {
    // A REST 404 alone cannot distinguish absence from hidden protection.
    if (!(error instanceof ClassicProtectionNotFound) || !hasRules) throw error;
    await verifyClassicProtectionAbsent(repo, trunk);
    return undefined;
  }
}
export type LandPolicy = {
  readonly reviews: number;
  readonly checks: readonly string[];
  readonly publishers: readonly {
    readonly context: string;
    readonly appId: number;
  }[];
  readonly blockers: readonly string[];
  readonly verification?: string;
};

export async function getGithubLandPolicy(
  repo: string,
  trunk: string
): Promise<LandPolicy> {
  const prefix = `repos/${repo}`;
  const repository = z
    .object({
      full_name: z.string(),
      allow_rebase_merge: z.boolean(),
      private: z.boolean().optional(),
      permissions: z.object({ admin: z.boolean().optional() }).optional(),
    })
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
  const { rules, verification } = await readApplicableLandRules(
    repo,
    trunk,
    repository.private === true &&
      repository.permissions?.admin === true &&
      !protection.protected
  );
  let reviews = 0;
  const checks = new Set<string>();
  const publishers: { readonly context: string; readonly appId: number }[] = [];
  const classic = protection.protected
    ? await readClassicLandPolicy(repo, trunk, rules.length > 0)
    : undefined;
  if (classic) {
    if (
      classic.url !==
      `https://api.github.com/repos/${repository.full_name}/branches/${branch}/protection`
    )
      throw new ExitFailedError('Classic protection identity mismatch.');
    reviews =
      classic.required_pull_request_reviews?.required_approving_review_count ??
      0;
    for (const name of classic.required_status_checks?.contexts ?? [])
      checks.add(name);
    for (const check of classic.required_status_checks?.checks ?? []) {
      checks.add(check.context);
      if (
        check.app_id !== undefined &&
        check.app_id !== null &&
        check.app_id !== -1
      )
        publishers.push({ context: check.context, appId: check.app_id });
    }
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
            required_status_checks: z.array(
              z.object({
                context: z.string(),
                integration_id: z.number().int().nullable().optional(),
              })
            ),
          })
          .parse(rule.parameters);
        for (const check of parameters.required_status_checks) {
          checks.add(check.context);
          if (
            check.integration_id !== undefined &&
            check.integration_id !== null
          )
            publishers.push({
              context: check.context,
              appId: check.integration_id,
            });
        }
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
  return { reviews, checks: [...checks], publishers, blockers, verification };
}

type LandReadiness = {
  readonly blockers: readonly string[];
  readonly pending: readonly string[];
  readonly warnings: readonly string[];
};

function pendingCheck(state: string): boolean {
  return ['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED'].includes(
    state
  );
}

export async function githubLandReadiness(
  pr: GithubPr,
  policy: LandPolicy,
  repo: string
): Promise<LandReadiness> {
  const blockers = [...policy.blockers];
  const pending: string[] = [];
  const warnings: string[] = [];
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
  if (policy.checks.length && !pr.statusCheckRollup)
    blockers.push('Checks unavailable.');
  const successful = new Set<string>();
  const running = new Set<string>();
  for (const check of pr.statusCheckRollup ?? []) {
    const name =
      (check.__typename === 'CheckRun' ? check.name : check.context) ??
      'unnamed';
    const state =
      check.__typename === 'CheckRun'
        ? check.status === 'COMPLETED'
          ? check.conclusion || 'UNKNOWN'
          : check.status || 'UNKNOWN'
        : check.state || 'UNKNOWN';
    const passed =
      check.__typename === 'CheckRun'
        ? check.status === 'COMPLETED' &&
          ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)
        : state === 'SUCCESS';
    if (!policy.checks.includes(name)) {
      if (!passed)
        warnings.push(`Optional check ${name}: ${state} (not blocking).`);
      continue;
    }
    if (passed) successful.add(name);
    else if (pendingCheck(state)) {
      running.add(name);
      pending.push(`Check ${name}: ${state}.`);
    } else blockers.push(`Check ${name}: ${state}.`);
  }
  for (const name of policy.checks)
    if (!successful.has(name) && !running.has(name))
      blockers.push(`Required check missing or not successful: ${name}.`);
  if (policy.publishers.length) {
    try {
      const publishers = await verifyCheckPublishers(
        repo,
        pr.headRefOid,
        policy.publishers
      );
      blockers.push(...publishers.blockers);
      pending.push(...publishers.pending);
    } catch {
      blockers.push(
        'Required check publisher evidence unavailable or incomplete.'
      );
    }
  }
  // UNSTABLE includes optional failures; enforce the verified required checks above.
  if (!['CLEAN', 'UNSTABLE'].includes(pr.mergeStateStatus ?? '')) {
    const message = `GitHub readiness is ${pr.mergeStateStatus || 'UNKNOWN'}.`;
    if (pending.length && pr.mergeStateStatus === 'BLOCKED')
      pending.unshift(message);
    else blockers.unshift(message);
  }
  return { blockers, pending, warnings };
}

const checkRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
  status: z.string(),
  conclusion: z.string().nullable(),
  app: z.object({ id: z.number().int().positive() }),
});

/** Fixed-publisher requirements need explicit provenance on the inspected head. */
async function verifyCheckPublishers(
  repo: string,
  head: string,
  publishers: LandPolicy['publishers']
): Promise<Pick<LandReadiness, 'blockers' | 'pending'>> {
  const runs: z.infer<typeof checkRunSchema>[] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const response = z
      .object({
        total_count: z.number().int().nonnegative(),
        check_runs: z.array(checkRunSchema).max(100),
      })
      .parse(
        await readGithubLandApi(
          `repos/${repo}/commits/${head}/check-runs?per_page=100&page=${page}&filter=latest`
        )
      );
    if (total !== undefined && total !== response.total_count)
      throw new ExitFailedError(
        'Check-run evidence changed during pagination.'
      );
    total = response.total_count;
    runs.push(...response.check_runs);
    if (response.check_runs.length < 100) break;
    if (page >= 1000)
      throw new ExitFailedError('Check-run pagination incomplete.');
  }
  if (
    runs.length !== total ||
    new Set(runs.map((run) => run.id)).size !== runs.length
  )
    throw new ExitFailedError('Check-run evidence incomplete or duplicated.');
  if (runs.some((run) => run.head_sha !== head))
    throw new ExitFailedError('Check-run evidence belongs to another head.');
  const blockers: string[] = [];
  const pending: string[] = [];
  for (const publisher of publishers) {
    const matching = runs.filter(
      (run) => run.name === publisher.context && run.app.id === publisher.appId
    );
    if (matching.length !== 1)
      blockers.push(
        `Required check publisher missing or ambiguous: ${publisher.context} (GitHub App ${publisher.appId}).`
      );
    else if (pendingCheck(matching[0].status.toUpperCase()))
      pending.push(
        `Required check publisher pending: ${publisher.context} (GitHub App ${publisher.appId}).`
      );
    else if (
      matching[0].status !== 'completed' ||
      !['success', 'neutral', 'skipped'].includes(matching[0].conclusion ?? '')
    )
      blockers.push(
        `Required check publisher not successful: ${publisher.context} (GitHub App ${publisher.appId}).`
      );
  }
  return { blockers, pending };
}
