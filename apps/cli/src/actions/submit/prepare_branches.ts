import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { TBranchPRInfo } from '../../lib/engine/metadata_ref';
import { editPRBody, getPRBody } from './pr_body';
import { getPRDraftStatus } from './pr_draft';
import { getPRTitle } from './pr_title';
import { getReviewers } from './reviewers';
import { TPRSubmissionInfo } from './submit_prs';
import { PreconditionsFailedError } from '../../lib/errors';
import {
  getGithubAuthorizationStatus,
  isGhInstalled,
} from '../../commands/auth';

type TPRSubmissionAction = { branchName: string } & (
  | { update: false }
  | {
      update: true;
      prNumber: number;
    }
);

/**
 * For now, we only allow users to update the following PR properties which
 * necessitate a PR update:
 * - the PR base
 * - the PR's code contents
 * - the PR's title
 * - the PR's body
 *
 * Therefore, we should only update the PR iff either of these properties
 * differ from our stored data on the previous PR submission.
 */
export async function getPRInfoForBranches(
  args: {
    branchNames: string[];
    editPRFieldsInline: boolean | undefined;
    draft: boolean;
    publish: boolean;
    updateOnly: boolean;
    dryRun: boolean;
    reviewers: string | undefined;
    rolesBranch?: string;
    select: boolean;
    always: boolean;
  },
  context: TContext
): Promise<TPRSubmissionInfo> {
  const submissionInfo: TPRSubmissionInfo = [];
  for await (const branchName of args.branchNames) {
    context.engine.assertBranchEditable(branchName);
    const reviewers =
      args.rolesBranch !== undefined && args.rolesBranch !== branchName
        ? undefined
        : args.reviewers;
    const action = await getPRAction(
      {
        branchName,
        updateOnly: args.updateOnly,
        draft: args.draft,
        publish: args.publish,
        dryRun: args.dryRun,
        select: args.select,
        editPRFieldsInline: args.editPRFieldsInline,
        always: args.always,
        reviewers,
      },
      context
    );
    if (!action) {
      continue;
    }

    context.engine.assertBranchEditable(branchName);
    const parentBranchName = context.engine.getParentPrecondition(
      action.branchName
    );

    const isGithubAuthPresent = cliAuthPrecondition(context);

    const prCreationInfo =
      isGithubAuthPresent && !action.update
        ? await getPRCreationInfo(
            {
              branchName: action.branchName,
              editPRFieldsInline: args.editPRFieldsInline,
              draft: args.draft,
              publish: args.publish,
              reviewers,
            },
            context
          )
        : {
            title: '',
            body: '',
            reviewers: [],
            draft: false,
          };

    context.engine.assertBranchEditable(branchName);
    submissionInfo.push({
      head: action.branchName,
      headSha: context.engine.getRevision(action.branchName),
      base: parentBranchName,
      baseSha: context.engine.getRevision(parentBranchName),
      ...(action.update
        ? {
            action: 'update' as const,
            prNumber: action.prNumber,
            ...(await getPRUpdateInfo(
              {
                branchName: action.branchName,
                editPRFieldsInline: args.editPRFieldsInline,
                draft: args.draft,
                publish: args.publish,
                reviewers,
              },
              context
            )),
          }
        : {
            action: 'create' as const,
            ...prCreationInfo,
          }),
    });
  }
  context.splog.newline();
  return submissionInfo;
}

async function getPRAction(
  args: {
    branchName: string;
    updateOnly: boolean;
    draft: boolean;
    publish: boolean;
    dryRun: boolean;
    always: boolean;
    reviewers: string | undefined;
    select: boolean;
    editPRFieldsInline: boolean | undefined;
  },
  context: TContext
): Promise<TPRSubmissionAction | undefined> {
  // The branch here should always have a parent - above, the branches we've
  // gathered should exclude trunk which ensures that every branch we're submitting
  // a PR for has a valid parent.
  const parentBranchName = context.engine.getParentPrecondition(
    args.branchName
  );
  const prInfo = context.engine.getPrInfo(args.branchName);
  const prNumber = prInfo?.number;

  const status =
    prNumber === undefined
      ? args.updateOnly
        ? 'NOOP'
        : 'CREATE'
      : parentBranchName !== prInfo?.base
      ? 'RESTACK'
      : !context.engine.branchMatchesRemote(args.branchName) ||
        args.editPRFieldsInline
      ? 'CHANGE'
      : args.draft === true && prInfo.isDraft !== true
      ? 'DRAFT'
      : args.publish === true && prInfo.isDraft !== false
      ? 'PUBLISH'
      : args.reviewers !== undefined
      ? 'REVIEWERS'
      : 'NOOP';

  const reviewAction = `Request review${
    args.reviewers ? `: ${args.reviewers}` : ' (interactive selection required)'
  }`;
  context.splog.info(
    {
      REVIEWERS: `▸ ${chalk.cyan(args.branchName)} (${reviewAction})`,
      NOOP: `▸ ${chalk.gray(args.branchName)} (No-op)`,
      CREATE: `▸ ${chalk.cyan(args.branchName)} (Create)`,
      RESTACK: `▸ ${chalk.cyan(args.branchName)} (New parent)`,
      CHANGE: `▸ ${chalk.cyan(args.branchName)} (Update)`,
      DRAFT: `▸ ${chalk.blueBright(args.branchName)} (Mark as draft)`,
      PUBLISH: `▸ ${chalk.blueBright(args.branchName)} (Ready for review)`,
    }[status]
  );

  if (status !== 'NOOP') {
    if (args.draft && status !== 'DRAFT' && prInfo?.isDraft !== true) {
      context.splog.info('  Mark as draft');
    }
    if (args.publish && status !== 'PUBLISH' && prInfo?.isDraft !== false) {
      context.splog.info('  Publish as ready for review');
    }
    if (args.reviewers !== undefined && status !== 'REVIEWERS') {
      context.splog.info(`  ${reviewAction}`);
    }
  }

  const shouldSkipUpdate =
    args.dryRun || (args.always === false && status === 'NOOP');

  return shouldSkipUpdate
    ? undefined
    : {
        branchName: args.branchName,
        ...(prNumber === undefined
          ? { update: false }
          : { update: true, prNumber }),
      };
}

async function getPRCreationInfo(
  args: {
    branchName: string;
    editPRFieldsInline: boolean | undefined;
    draft: boolean;
    publish: boolean;
    reviewers: string | undefined;
  },
  context: TContext
): Promise<{
  title: string;
  body: string;
  reviewers: string[];
  draft: boolean;
}> {
  context.engine.assertBranchEditable(args.branchName);
  if (args.editPRFieldsInline) {
    context.splog.newline();
    context.splog.info(
      `Enter info for new pull request for ${chalk.cyan(
        args.branchName
      )} ▸ ${chalk.blueBright(
        context.engine.getParentPrecondition(args.branchName)
      )}:`
    );
  }

  const submitInfo: TBranchPRInfo = {};

  try {
    submitInfo.title = await getPRTitle(
      {
        branchName: args.branchName,
        editPRFieldsInline: args.editPRFieldsInline,
      },
      context
    );

    context.engine.assertBranchEditable(args.branchName);
    submitInfo.body = await getPRBody(
      {
        branchName: args.branchName,
        editPRFieldsInline: args.editPRFieldsInline,
      },
      context
    );
  } finally {
    // Save locally in case this command fails, unless an external UI froze it.
    context.engine.assertBranchEditable(args.branchName);
    context.engine.upsertPrInfo(args.branchName, submitInfo);
  }

  context.engine.assertBranchEditable(args.branchName);
  const reviewers = await getReviewersMaybeInteractively(
    args.reviewers,
    context
  );

  context.engine.assertBranchEditable(args.branchName);
  const createAsDraft = args.publish
    ? false
    : args.draft || !context.canPrompt
    ? true
    : await getPRDraftStatus(context);

  return {
    title: submitInfo.title,
    body: submitInfo.body,
    reviewers,
    draft: createAsDraft,
  };
}

async function getPRUpdateInfo(
  args: {
    branchName: string;
    editPRFieldsInline: boolean | undefined;
    draft: boolean;
    publish: boolean;
    reviewers: string | undefined;
  },
  context: TContext
): Promise<{
  title?: string;
  body?: string;
  reviewers: string[];
  draft: boolean | undefined;
}> {
  const submitInfo: TBranchPRInfo = {};
  if (args.editPRFieldsInline) {
    context.splog.newline();
    context.splog.info(
      `Enter updated info for pull request for ${chalk.cyan(
        args.branchName
      )} ▸ ${chalk.blueBright(
        context.engine.getParentPrecondition(args.branchName)
      )}:`
    );

    try {
      submitInfo.title = await getPRTitle(
        {
          branchName: args.branchName,
          editPRFieldsInline: args.editPRFieldsInline,
        },
        context
      );

      context.engine.assertBranchEditable(args.branchName);
      const prInfo = context.engine.getPrInfo(args.branchName);
      if (prInfo === undefined) {
        context.splog.warn(
          'Cannot find existing PR body; starting from scratch'
        );
      }
      const body = prInfo?.body || '';
      submitInfo.body = await editPRBody(body, context);
    } finally {
      // Save locally in case this command fails, unless an external UI froze it.
      context.engine.assertBranchEditable(args.branchName);
      context.engine.upsertPrInfo(args.branchName, submitInfo);
    }
  }

  context.engine.assertBranchEditable(args.branchName);
  const reviewers = await getReviewersMaybeInteractively(
    args.reviewers,
    context
  );

  context.engine.assertBranchEditable(args.branchName);
  const draft = args.draft ? true : args.publish ? false : undefined;

  return {
    title: submitInfo.title,
    body: submitInfo.body,
    reviewers,
    draft,
  };
}

async function getReviewersMaybeInteractively(
  reviewers: string | undefined,
  context: TContext
): Promise<string[]> {
  if (reviewers === '') {
    const response = await context.prompts({
      type: 'list',
      name: 'reviewers',
      message: 'Reviewers (comma-separated GitHub usernames)',
      separator: ',',
    });
    return response.reviewers;
  }

  return getReviewers(reviewers);
}

function cliAuthPrecondition(context: TContext): boolean {
  const isGithubIntegrationEnabled =
    context.repoConfig.getIsGithubIntegrationEnabled();

  if (isGithubIntegrationEnabled && !isGhInstalled()) {
    throw new PreconditionsFailedError(
      `The GitHub CLI (\`gh\`) is required but was not found on your PATH. Install it from https://cli.github.com and run \`an auth\`. To use Anthracite without GitHub integration, run \`an repo github --no-enable\`.`
    );
  }

  const isGhAuthorized = getGithubAuthorizationStatus();

  if (isGithubIntegrationEnabled && !isGhAuthorized) {
    throw new PreconditionsFailedError(
      `Please authenticate your CLI with Github by running an auth and then retry. To ignore this message in the future and use Anthracite without Github integration, run an repo github --no-enable.`
    );
  }

  return isGhAuthorized;
}
