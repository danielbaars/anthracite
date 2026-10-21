import { API_ROUTES } from '@withgraphite/graphite-cli-routes';
import * as t from '@withgraphite/retype';
import chalk from 'chalk';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { Unpacked } from '../../lib/utils/ts_helpers';
import { execFileSync } from 'child_process';
import { readPrDraftStatus } from './pr_status';

export type TPRSubmissionInfo = t.UnwrapSchemaMap<
  typeof API_ROUTES.submitPullRequests.params
>['prs'];

type TSubmittedPRRequest = Unpacked<TPRSubmissionInfo>;

type TSubmittedPRResponse = Unpacked<
  t.UnwrapSchemaMap<typeof API_ROUTES.submitPullRequests.response>['prs']
> & { isDraft?: boolean };

const existingPrSchema = t.shape({
  headRefName: t.string,
  url: t.string,
  number: t.number,
  baseRefName: t.string,
  body: t.string,
  isDraft: t.boolean,
});

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
  context.splog.info(
    `${chalk.green(pr.response.head)}: ${pr.response.prURL} (${{
      updated: chalk.yellow,
      created: chalk.green,
    }[pr.response.status](pr.response.status)}${
      pr.response.isDraft === false ? '; ready for review' : ''
    })`
  );
}

async function requestServerToSubmitPR({
  submissionInfo,
  repo,
}: {
  submissionInfo: TPRSubmissionInfo;
  repo: string;
}): Promise<TSubmittedPR> {
  const request = submissionInfo[0];

  try {
    const response = await submitPrToGithub({
      request,
      repo,
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
}: {
  request: TSubmittedPRRequest;
  repo: string;
}): Promise<TSubmittedPRResponse> {
  // prepare_branches always attaches reviewers, but the route type only
  // declares them on the 'create' variant.
  const reviewers = (request as { reviewers?: string[] }).reviewers ?? [];
  let prInfo: unknown;
  try {
    prInfo = JSON.parse(
      execFileSync('gh', [
        'pr',
        'view',
        request.head,
        '--repo',
        repo,
        '--json',
        'headRefName,url,number,baseRefName,body,isDraft',
      ]).toString()
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('no pull requests found')
    ) {
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
        ...reviewers.flatMap((r) => ['--reviewer', r]),
      ])
        .toString()
        .trim();

      const prNumber = getPrNumberFromUrl(result);

      const isDraft = readPrDraftStatus(request.head, prNumber, repo);
      if (isDraft !== request.draft) {
        throw new Error(
          `GitHub did not confirm the requested status for ${request.head} (PR #${prNumber})`
        );
      }
      return {
        isDraft,
        head: request.head,
        status: 'created',
        prNumber,
        prURL: result,
      };
    }

    throw error;
  }
  if (!existingPrSchema(prInfo)) {
    throw new Error(`Invalid GitHub PR response for ${request.head}`);
  }
  if (prInfo.headRefName !== request.head) {
    throw Error(`PR head mismatch: ${prInfo.headRefName} !== ${request.head}`);
  }

  const prBaseChanged = prInfo.baseRefName !== request.base;

  const editArgs = [
    ...(prBaseChanged ? ['--base', request.base] : []),
    ...reviewers.flatMap((r) => ['--add-reviewer', r]),
  ];

  if (editArgs.length) {
    execFileSync('gh', [
      'pr',
      'edit',
      prInfo.headRefName,
      '--repo',
      repo,
      ...editArgs,
    ]);
  }

  if (request.draft === false && prInfo.isDraft) {
    execFileSync('gh', ['pr', 'ready', String(prInfo.number), '--repo', repo]);
  }
  const isDraft = readPrDraftStatus(request.head, prInfo.number, repo);
  if (request.draft === false && isDraft) {
    throw new Error(
      `GitHub did not confirm ${request.head} (PR #${prInfo.number}) as ready for review`
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
