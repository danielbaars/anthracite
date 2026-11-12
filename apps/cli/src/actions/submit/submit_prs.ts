import { API_ROUTES } from '@withgraphite/graphite-cli-routes';
import * as t from '@withgraphite/retype';
import { getGithubPr, GithubPr } from '../../lib/api/github_pr';
import chalk from 'chalk';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { TContext } from '../../lib/context';
import { assertBranchEditable } from '../../lib/engine/frozen_branch';
import { ExitFailedError } from '../../lib/errors';
import { Unpacked } from '../../lib/utils/ts_helpers';
import { execFileSync } from 'child_process';
import { readPrDraftStatus } from './pr_status';
import { requestReviewers } from './request_reviewers';
import { requestAssignees } from './request_assignees';
import { getSha } from '../../lib/git/get_sha';

export type TPRSubmissionInfo = (Unpacked<
  t.UnwrapSchemaMap<typeof API_ROUTES.submitPullRequests.params>['prs']
> & { assignees?: readonly string[] })[];

type TSubmittedPRRequest = Unpacked<TPRSubmissionInfo>;

type TSubmittedPRResponse = Unpacked<
  t.UnwrapSchemaMap<typeof API_ROUTES.submitPullRequests.response>['prs']
> & { isDraft?: boolean };

type TSubmittedPR = {
  request: TSubmittedPRRequest;
  response: TSubmittedPRResponse;
};

export async function submitPullRequest(
  submissionInfo: TPRSubmissionInfo,
  context: TContext,
  plannedMetadata: Map<string, string>
): Promise<void> {
  const assertInputs = (): void =>
    assertSubmitInputs(submissionInfo[0], context, plannedMetadata);
  assertInputs();
  const pr = await requestServerToSubmitPR({
    submissionInfo,
    repo: githubRepoSlug(context),
    context,
    assertInputs,
  });

  if (pr.response.status === 'error') {
    throw new ExitFailedError(
      `Failed to submit PR for ${pr.response.head}: ${pr.response.error}`
    );
  }

  try {
    assertInputs();
    const published = context.engine.upsertPrInfo(pr.response.head, {
      number: pr.response.prNumber,
      url: pr.response.prURL,
      base: pr.request.base,
      state: 'OPEN', // We know this is not closed or merged because submit succeeded
      ...(pr.request.action === 'create'
        ? {
            title: pr.request.title,
            body: pr.request.body,
            reviewDecision: 'REVIEW_REQUIRED', // Because we just opened this PR
          }
        : {}),
      ...(pr.response.isDraft !== undefined
        ? { isDraft: pr.response.isDraft }
        : {}),
    });
    if (!published)
      throw new ExitFailedError('No confirmed local PR cache publication.');
    // Advance only to the blob returned by our own publication, never a fresh adoption.
    plannedMetadata.set(pr.response.head, published);
    assertInputs();
  } catch (error) {
    throw new ExitFailedError(
      `PR ${pr.response.status} at ${
        pr.response.prURL
      }; local cache publication could not be verified. Remote effects are retained. ${
        error instanceof Error ? error.message : String(error)
      }\nNot attempted: reviewers and assignees.`
    );
  }
  const reviewers = 'reviewers' in pr.request ? pr.request.reviewers ?? [] : [];
  try {
    if (reviewers.length)
      await assertOpenSubmitTarget(
        pr.response.head,
        pr.response.prNumber,
        context
      );
    assertInputs();
    requestReviewers(
      {
        head: pr.response.head,
        number: pr.response.prNumber,
        repo: githubRepoSlug(context),
      },
      reviewers,
      assertInputs
    );
  } catch (error) {
    throw new ExitFailedError(
      `PR ${pr.response.status} at ${
        pr.response.prURL
      }; review request failed for ${reviewers.join(', ')}: ${
        error instanceof Error ? error.message : String(error)
      }\nNot attempted: assignees ${
        pr.request.assignees?.join(', ') || '(none requested)'
      }.`
    );
  }
  try {
    if (pr.request.assignees?.length)
      await assertOpenSubmitTarget(
        pr.response.head,
        pr.response.prNumber,
        context
      );
    assertInputs();
    requestAssignees(
      {
        head: pr.response.head,
        number: pr.response.prNumber,
        repo: githubRepoSlug(context),
      },
      pr.request.assignees ?? [],
      assertInputs
    );
  } catch (error) {
    throw new ExitFailedError(
      `PR ${pr.response.status} at ${pr.response.prURL}; assignment failed: ${
        error instanceof Error ? error.message : String(error)
      }\nConfirmed reviewers: ${reviewers.join(', ') || 'none requested'}.`
    );
  }
  context.splog.info(
    `${chalk.green(pr.response.head)}: ${pr.response.prURL} (${{
      updated: chalk.yellow,
      created: chalk.green,
    }[pr.response.status](pr.response.status)}${
      pr.response.isDraft === false
        ? '; ready for review'
        : pr.response.isDraft === true
        ? '; draft'
        : ''
    })`
  );
}

async function requestServerToSubmitPR({
  submissionInfo,
  repo,
  context,
  assertInputs,
}: {
  context: TContext;
  submissionInfo: TPRSubmissionInfo;
  repo: string;
  assertInputs: () => void;
}): Promise<TSubmittedPR> {
  const request = submissionInfo[0];

  try {
    const response = await submitPrToGithub({
      request,
      repo,
      context,
      assertInputs,
    });

    return {
      request,
      response,
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        response: { error: error.message, status: 'error', head: request.head },
        request,
      };
    }

    throw Error(`Unknown error: ${error}`);
  }
}

async function submitPrToGithub({
  request,
  repo,
  context,
  assertInputs,
}: {
  request: TSubmittedPRRequest;
  repo: string;
  context: TContext;
  assertInputs: () => void;
}): Promise<TSubmittedPRResponse> {
  let prInfo = await getGithubPr(request.head, context, 'open');
  assertInputs();
  if (request.action === 'create') {
    if (prInfo)
      throw new Error(
        `PR target changed for ${request.head}; inspect and rerun submit before updating the newly discovered PR.`
      );
    assertBranchEditable(request.head);
    const result = execFileSync('gh', [
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      request.head,
      '--base',
      request.base,
      '--title',
      request.title ?? '',
      '--body',
      request.body ?? '',
      ...(request.draft ? ['--draft'] : []),
    ])
      .toString()
      .trim();
    const { prNumber, isDraft } = await confirmCreatedPr({
      request,
      result,
      context,
      assertInputs,
    });
    return {
      isDraft,
      head: request.head,
      status: 'created',
      prNumber,
      prURL: result,
    };
  }
  if (!prInfo || prInfo.number !== request.prNumber)
    throw new Error(
      `Open PR target changed for ${request.head}; no PR changes were attempted. Inspect and rerun submit.`
    );
  prInfo = await confirmSubmittedHead(
    { request, initial: prInfo, assertInputs },
    context
  );
  const prBaseChanged = prInfo.baseRefName !== request.base;

  const editArgs = [
    ...(prBaseChanged ? ['--base', request.base] : []),
    ...(request.title !== undefined && request.title !== prInfo.title
      ? ['--title', request.title]
      : []),
  ];

  if (editArgs.length) {
    await assertOpenSubmitTarget(request.head, prInfo.number, context);
    assertInputs();
    assertBranchEditable(request.head);
    execFileSync('gh', [
      'pr',
      'edit',
      String(prInfo.number),
      '--repo',
      repo,
      ...editArgs,
    ]);
    assertInputs();
  }

  if (request.draft !== undefined && request.draft !== prInfo.isDraft) {
    await assertOpenSubmitTarget(request.head, prInfo.number, context);
    assertInputs();
    assertBranchEditable(request.head);
    execFileSync('gh', [
      'pr',
      'ready',
      String(prInfo.number),
      '--repo',
      repo,
      ...(request.draft ? ['--undo'] : []),
    ]);
    assertInputs();
  }
  const isDraft = readPrDraftStatus(request.head, prInfo.number, repo);
  assertInputs();
  if (request.draft !== undefined && isDraft !== request.draft) {
    throw new Error(
      `GitHub did not confirm ${request.head} (PR #${prInfo.number}) as ${
        request.draft ? 'draft' : 'ready for review'
      }`
    );
  }

  return {
    isDraft,
    head: prInfo.headRefName,
    status: 'updated',
    prNumber: prInfo.number,
    prURL: prInfo.url,
  };
}

async function confirmSubmittedHead(
  {
    request,
    initial,
    assertInputs,
  }: {
    request: Extract<TSubmittedPRRequest, { action: 'update' }>;
    initial: GithubPr;
    assertInputs: () => void;
  },
  context: TContext
): Promise<GithubPr> {
  let pr = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    assertInputs();
    await context.engine.populateRemoteShas();
    assertInputs();
    if (!context.engine.branchMatchesRemote(request.head))
      throw new ExitFailedError(
        `Remote branch ${request.head} no longer confirms this submit's pushed commit (changed or unavailable); no PR changes were attempted.`
      );
    if (pr.number !== request.prNumber || pr.state !== 'OPEN')
      throw new ExitFailedError(
        `Open PR target changed for ${request.head}; no PR changes were attempted.`
      );
    if (pr.headRefOid === request.headSha) return pr;
    if (attempt < 2) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      const fresh = await getGithubPr(request.head, context, 'pinned');
      if (!fresh)
        throw new ExitFailedError(
          `PR information unavailable for ${request.head}.`
        );
      pr = fresh;
    }
  }
  throw new ExitFailedError(
    `GitHub has not confirmed the commit pushed for ${request.head}; its remote branch still matches this submit. PR visibility remains unconfirmed after bounded reads; rerun submit to finish PR and dependency footer updates.`
  );
}

async function confirmCreatedPr({
  request,
  result,
  context,
  assertInputs,
}: {
  request: TSubmittedPRRequest;
  result: string;
  context: TContext;
  assertInputs: () => void;
}): Promise<{ prNumber: number; isDraft: boolean }> {
  const repo = githubRepoSlug(context);
  const prNumber = getPrNumberFromUrl(result);
  if (
    result.toLowerCase() !==
    `https://github.com/${repo}/pull/${prNumber}`.toLowerCase()
  )
    throw new Error(`Invalid GitHub PR creation identity for ${request.head}`);
  let isDraft: boolean;
  try {
    assertInputs();
    const created = await getGithubPr(request.head, context, 'open');
    assertInputs();
    if (!created || created.number !== prNumber)
      throw new Error(
        `Could not confirm newly created PR for ${request.head}; reconcile before retrying.`
      );
    isDraft = readPrDraftStatus(request.head, prNumber, repo);
    assertInputs();
    if (isDraft !== request.draft)
      throw new Error(
        `GitHub did not confirm the requested status for ${request.head} (PR #${prNumber})`
      );
  } catch (error) {
    throw new ExitFailedError(
      `PR creation returned ${result}; reconcile before retrying. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return { prNumber, isDraft };
}

function getPrNumberFromUrl(url: string): number {
  const prNumber = url.match(/\/pull\/(\d+)$/)?.[1];

  if (!prNumber) {
    throw Error(`Could not find PR number in response: ${url}`);
  }

  return Number(prNumber);
}

export async function assertOpenSubmitTarget(
  branch: string,
  number: number,
  context: TContext
): Promise<void> {
  const pr = await getGithubPr(branch, context, 'pinned');
  if (!pr || pr.number !== number || pr.state !== 'OPEN')
    throw new ExitFailedError(
      `Open PR target changed for ${branch}; refusing a historical or different PR write. Inspect and rerun submit.`
    );
}

/** Confirmation does not make a stale PR plan authoritative. */
export async function assertSubmitTargets(
  submissionInfo: Readonly<TPRSubmissionInfo>,
  context: TContext,
  plannedMetadata: ReadonlyMap<string, string>
): Promise<void> {
  const targets = await Promise.all(
    submissionInfo.map(async (request) => ({
      request,
      pr: await getGithubPr(request.head, context, 'open'),
    }))
  );
  for (const { request, pr } of targets) {
    assertSubmitInputs(request, context, plannedMetadata);
    if (
      request.action === 'create'
        ? pr !== undefined
        : !pr || pr.number !== request.prNumber
    )
      throw new ExitFailedError(
        `Open PR target changed for ${request.head}; replan before pushing. No code was pushed by this submit attempt.`
      );
  }
}

/** Re-read refs rather than accepting cached revisions from before confirmation. */
export function assertSubmitInputs(
  request: TSubmittedPRRequest,
  context: TContext,
  plannedMetadata: ReadonlyMap<string, string>
): void {
  context.engine.assertBranchEditable(request.head);
  if (
    getSha(`refs/heads/${request.head}`) !== request.headSha ||
    getSha(`refs/heads/${request.base}`) !== request.baseSha ||
    getSha(`refs/branch-metadata/${request.head}`) !==
      plannedMetadata.get(request.head)
  )
    throw new ExitFailedError(
      `Local submission inputs changed for ${request.head}; replan before pushing.`
    );
}
