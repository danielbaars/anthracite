import { API_ROUTES } from '@withgraphite/graphite-cli-routes';
import * as t from '@withgraphite/retype';
import { getGithubPr } from '../../lib/api/github_pr';
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
  context: TContext
): Promise<void> {
  const pr = await requestServerToSubmitPR({
    submissionInfo,
    repo: githubRepoSlug(context),
    context,
  });

  if (pr.response.status === 'error') {
    throw new ExitFailedError(
      `Failed to submit PR for ${pr.response.head}: ${pr.response.error}`
    );
  }

  context.engine.upsertPrInfo(pr.response.head, {
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
  const reviewers = 'reviewers' in pr.request ? pr.request.reviewers ?? [] : [];
  try {
    if (reviewers.length)
      await assertOpenSubmitTarget(
        pr.response.head,
        pr.response.prNumber,
        context
      );
    requestReviewers(
      {
        head: pr.response.head,
        number: pr.response.prNumber,
        repo: githubRepoSlug(context),
      },
      reviewers
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
    requestAssignees(
      {
        head: pr.response.head,
        number: pr.response.prNumber,
        repo: githubRepoSlug(context),
      },
      pr.request.assignees ?? []
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
}: {
  context: TContext;
  submissionInfo: TPRSubmissionInfo;
  repo: string;
}): Promise<TSubmittedPR> {
  const request = submissionInfo[0];

  try {
    const response = await submitPrToGithub({
      request,
      repo,
      context,
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
}: {
  request: TSubmittedPRRequest;
  repo: string;
  context: TContext;
}): Promise<TSubmittedPRResponse> {
  const prInfo = await getGithubPr(request.head, context, 'open');
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
    const prNumber = getPrNumberFromUrl(result);
    if (
      result.toLowerCase() !==
      `https://github.com/${repo}/pull/${prNumber}`.toLowerCase()
    )
      throw new Error(
        `Invalid GitHub PR creation identity for ${request.head}`
      );
    const created = await getGithubPr(request.head, context, 'open');
    if (!created || created.number !== prNumber)
      throw new Error(
        `Could not confirm newly created PR for ${request.head}; reconcile before retrying.`
      );
    const isDraft = readPrDraftStatus(request.head, prNumber, repo);
    if (isDraft !== request.draft)
      throw new Error(
        `GitHub did not confirm the requested status for ${request.head} (PR #${prNumber})`
      );
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
  const prBaseChanged = prInfo.baseRefName !== request.base;

  const editArgs = [...(prBaseChanged ? ['--base', request.base] : [])];

  if (editArgs.length) {
    await assertOpenSubmitTarget(request.head, prInfo.number, context);
    assertBranchEditable(request.head);
    execFileSync('gh', [
      'pr',
      'edit',
      String(prInfo.number),
      '--repo',
      repo,
      ...editArgs,
    ]);
  }

  if (request.draft !== undefined && request.draft !== prInfo.isDraft) {
    await assertOpenSubmitTarget(request.head, prInfo.number, context);
    assertBranchEditable(request.head);
    execFileSync('gh', [
      'pr',
      'ready',
      String(prInfo.number),
      '--repo',
      repo,
      ...(request.draft ? ['--undo'] : []),
    ]);
  }
  const isDraft = readPrDraftStatus(request.head, prInfo.number, repo);
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
