import chalk from 'chalk';
import { getAssignees } from './assignees';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { TContext } from '../../lib/context';
import { SCOPE, TScopeSpec } from '../../lib/engine/scope_spec';
import { ExitFailedError, KilledError } from '../../lib/errors';
import { CommandFailedError, CommandKilledError } from '../../lib/git/runner';
import { getPRInfoForBranches } from './prepare_branches';
import { validateBranchesToSubmit } from './validate_branches';
import {
  assertOpenSubmitTarget,
  assertSubmitInputs,
  assertSubmitTargets,
  submitPullRequest,
  TPRSubmissionInfo,
} from './submit_prs';
import {
  createPrBodyFooter,
  footerFooter,
  legacyFooterFooter,
  footerTitle,
} from '../create_pr_body_footer';
import { execFileSync } from 'child_process';
import { syncPrInfo } from '../sync_pr_info';
import { getShaOrThrow } from '../../lib/git/get_sha';

// eslint-disable-next-line max-lines-per-function
export async function submitAction(
  args: {
    scope: TScopeSpec;
    editPRFieldsInline: boolean | undefined;
    draft: boolean;
    publish: boolean;
    dryRun: boolean;
    updateOnly: boolean;
    reviewers: string | undefined;
    assignees?: string;
    rolesBranch?: string;
    confirm: boolean;
    forcePush: boolean;
    select: boolean;
    always: boolean;
    branch: string | undefined;
  },
  context: TContext
): Promise<void> {
  // Check CLI pre-condition to warn early
  if (args.draft && args.publish) {
    throw new ExitFailedError(
      `Can't use both --publish and --draft flags in one command`
    );
  }
  if (
    !context.canPrompt &&
    args.reviewers !== undefined &&
    !(args.dryRun && args.reviewers === '') &&
    args.reviewers.split(',').some((reviewer) => !reviewer.trim())
  ) {
    throw new ExitFailedError(
      'Provide a non-empty reviewer username with --reviewers in non-interactive mode.'
    );
  }
  const assignees = getAssignees(args.assignees);
  if (
    args.rolesBranch !== undefined &&
    args.reviewers === undefined &&
    assignees === undefined
  ) {
    throw new ExitFailedError(
      '--roles-branch requires --reviewers or --assignees.'
    );
  }
  if (args.dryRun) {
    context.splog.info(
      chalk.yellow(
        `Running submit in 'dry-run' mode. No branches will be pushed and no PRs will be opened or updated.`
      )
    );
    context.splog.newline();
    args.editPRFieldsInline = false;
    args.select = false;
    args.confirm = false;
  }

  if (!context.canPrompt) {
    args.editPRFieldsInline = false;
    args.select = false;
    args.confirm = false;

    context.splog.info(
      `Running in non-interactive mode. Inline prompts to fill PR fields will be skipped${
        !(args.draft || args.publish)
          ? ' and new PRs will be created in draft mode'
          : ''
      }.`
    );
    context.splog.newline();
  }

  const allBranchNames = filterFrozenBranches(
    context.engine
      .getRelativeStack(
        args.branch ?? context.engine.currentBranchPrecondition,
        args.scope
      )
      .filter((branchName) => !context.engine.isTrunk(branchName)),
    context
  );

  const branchNames = args.select
    ? filterFrozenBranches(
        await selectBranches(context, allBranchNames),
        context
      )
    : allBranchNames;

  if (
    args.rolesBranch !== undefined &&
    !branchNames.includes(args.rolesBranch)
  ) {
    throw new ExitFailedError(
      `Role target "${args.rolesBranch}" is not a selected editable submission branch.`
    );
  }

  if (branchNames.length === 0) {
    context.splog.info('No editable branches to submit.');
    return;
  }

  context.splog.info(
    chalk.blueBright(
      `🥞 Validating that this Anthracite stack is ready to submit...`
    )
  );
  context.splog.newline();
  await context.engine.populateRemoteShas();
  await validateBranchesToSubmit(branchNames, context);
  if (
    args.rolesBranch !== undefined &&
    args.updateOnly &&
    context.engine.getPrInfo(args.rolesBranch)?.number === undefined
  ) {
    throw new ExitFailedError(
      `Role target "${args.rolesBranch}" is skipped by --update-only because it has no existing PR.`
    );
  }

  context.splog.info(
    chalk.blueBright(
      '✏️  Preparing to submit PRs for the following branches...'
    )
  );
  const submissionInfos = await getPRInfoForBranches(
    {
      branchNames: branchNames,
      editPRFieldsInline: args.editPRFieldsInline && context.canPrompt,
      draft: args.draft,
      publish: args.publish,
      updateOnly: args.updateOnly,
      reviewers: args.reviewers,
      assignees,
      rolesBranch: args.rolesBranch,
      dryRun: args.dryRun,
      select: args.select,
      always: args.always,
    },
    context
  );

  const pendingFooters = await getPrFooterUpdates(
    branchNames,
    submissionInfos,
    context
  );
  if (pendingFooters.length) {
    context.splog.info(
      `Dependency footers to repair: ${pendingFooters
        .map((update) => `${update.branch} (#${update.number})`)
        .join(', ')}`
    );
  }

  const plannedMetadata = new Map(
    submissionInfos.map((info) => [
      info.head,
      getShaOrThrow(`refs/branch-metadata/${info.head}`),
    ])
  );
  if (
    await shouldAbort(
      {
        ...args,
        hasAnyPrs: submissionInfos.length > 0 || pendingFooters.length > 0,
      },
      context
    )
  ) {
    return;
  }

  if (args.rolesBranch !== undefined) {
    context.engine.assertBranchEditable(args.rolesBranch);
  }

  await assertSubmitTargets(submissionInfos, context, plannedMetadata);

  if (submissionInfos.length) {
    context.splog.info(
      chalk.blueBright('📨 Pushing to remote and creating/updating PRs...')
    );
  }

  for (const [index, submissionInfo] of submissionInfos.entries()) {
    const remaining = submissionInfos.slice(index + 1).map((info) => info.head);
    const notAttempted = `Not attempted: ${
      remaining.length ? `submission of ${remaining.join(', ')}; ` : ''
    }dependency footer updates.`;
    try {
      assertSubmitInputs(submissionInfo, context, plannedMetadata);
      context.engine.pushBranch(submissionInfo.head, args.forcePush);
    } catch (err) {
      if (err instanceof CommandKilledError) throw err;
      if (
        err instanceof CommandFailedError &&
        err.message.includes('stale info')
      ) {
        throw new ExitFailedError(
          [
            `Force-with-lease push of ${chalk.yellow(
              submissionInfo.head
            )} failed due to external changes to the remote branch.`,
            'If you are collaborating on this stack, try `an get` to pull in changes.',
            'Alternatively, use the `--force` option of this command to bypass the stale info warning.',
            notAttempted,
          ].join('\n')
        );
      }
      throw new ExitFailedError(
        `${err instanceof Error ? err.message : String(err)}\n${
          index ? 'Earlier confirmed submissions remain applied.\n' : ''
        }Not attempted: PR and role changes for ${
          submissionInfo.head
        }. ${notAttempted}`
      );
    }

    try {
      await submitPullRequest([submissionInfo], context);
    } catch (error) {
      throw new ExitFailedError(
        `${error instanceof Error ? error.message : String(error)}\nCode for ${
          submissionInfo.head
        } was already pushed; earlier confirmed PR changes remain applied.\n${notAttempted}`
      );
    }
  }

  context.splog.info(
    chalk.blueBright('\n🌳 Updating dependency trees in PR bodies...')
  );

  const repo = githubRepoSlug(context);
  let footerUpdates: Awaited<ReturnType<typeof getPrFooterUpdates>>;
  try {
    footerUpdates = await getPrFooterUpdates(
      branchNames,
      submissionInfos,
      context
    );
  } catch (error) {
    throw new ExitFailedError(
      `${
        error instanceof Error ? error.message : String(error)
      }\nAny confirmed PR submissions remain applied. Dependency footer updates not attempted; rerun submit with the same selection after resolving the lookup failure.`
    );
  }
  for (const [index, update] of footerUpdates.entries()) {
    try {
      context.engine.assertBranchEditable(update.branch);
      await assertOpenSubmitTarget(update.branch, update.number, context);
      execFileSync('gh', [
        'pr',
        'edit',
        `${update.number}`,
        '--repo',
        repo,
        '--body',
        update.body,
      ]);
    } catch (error) {
      const pending = footerUpdates
        .slice(index)
        .map((item) => `${item.branch} (#${item.number})`);
      throw new ExitFailedError(
        [
          `Dependency footer update failed for ${update.branch} (#${update.number}).`,
          'Earlier confirmed PR and footer updates remain applied.',
          `Unconfirmed or stale dependency footers: ${pending.join(', ')}.`,
          'Rerun submit with the same selection to repair these footers; no new commit is required.',
          error instanceof Error ? error.message : String(error),
        ].join('\n')
      );
    }
    context.splog.info(
      `${chalk.green(update.branch)}: ${update.url} (${chalk.yellow(
        'Updated'
      )})`
    );
  }
}

async function getPrFooterUpdates(
  branchNames: readonly string[],
  submissionInfos: Readonly<TPRSubmissionInfo>,
  context: TContext
): Promise<{ branch: string; number: number; url?: string; body: string }[]> {
  if (!context.repoConfig.getIsGithubIntegrationEnabled()) return [];
  // Submitting changes the dependency tree of the submitted branches and ancestors.
  const branchesToUpdate = new Set<string>(branchNames);
  for (const branch of branchNames) {
    let ancestor = context.engine.getParent(branch);
    while (ancestor && !context.engine.isTrunk(ancestor)) {
      branchesToUpdate.add(ancestor);
      ancestor = context.engine.getParent(ancestor);
    }
  }

  // The rendered tree also references descendants outside this submission.
  const referencedDescendants = [
    ...new Set(
      branchNames.flatMap((branch) =>
        context.engine.getRelativeStack(branch, SCOPE.UPSTACK_EXCLUSIVE)
      )
    ),
  ].filter(
    (branch) =>
      !branchesToUpdate.has(branch) &&
      !context.engine.isBranchFrozen(branch) &&
      context.engine.getPrInfo(branch)?.number !== undefined
  );
  await syncPrInfo(referencedDescendants, context);

  const footerBranches = [...branchesToUpdate].filter(
    (branch) =>
      !context.engine.isBranchFrozen(branch) &&
      Boolean(context.engine.getPrInfo(branch)?.number)
  );
  const editedBodies = submissionInfos.filter(
    (info) => info.action === 'update' && info.body !== undefined
  );
  // Inline edits are current user input; all other bodies need a fresh read.
  const freshPrs = (
    await Promise.all(
      footerBranches
        .filter((branch) => !editedBodies.some((info) => info.head === branch))
        .map(async (branch) => {
          const number = context.engine.getPrInfo(branch)?.number;
          try {
            return await syncPrInfo([branch], context);
          } catch (error) {
            throw new ExitFailedError(
              `Cannot read fresh PR body for ${branch} (#${number}); cached text will not be used. ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        })
    )
  ).flat();
  const updates = [];
  for (const branch of footerBranches) {
    if (context.engine.isBranchFrozen(branch)) continue;
    const prInfo = context.engine.getPrInfo(branch);

    // A branch with no open PR (e.g. an unsubmitted leaf under --update-only)
    // has no body to update; skip it rather than `gh pr edit undefined` (#109).
    if (!prInfo?.number) {
      continue;
    }

    const fresh = freshPrs.find(
      (pr) => pr.headRefName === branch && pr.prNumber === prInfo.number
    );
    const body =
      editedBodies.find((info) => info.head === branch)?.body ?? fresh?.body;
    if (typeof body !== 'string') {
      throw new ExitFailedError(
        `Cannot read fresh PR body for ${branch} (#${prInfo.number}); cached text will not be used.`
      );
    }
    const footer = createPrBodyFooter(context, branch);
    if (!body.includes(footer)) {
      updates.push({
        branch,
        number: prInfo.number,
        url: prInfo.url,
        body: updatePrBodyFooter(body, footer),
      });
    }
  }
  return updates;
}

export function updatePrBodyFooter(
  body: string | undefined,
  footer: string
): string {
  if (!body) {
    return footer;
  }

  // Get the core title and footer text without extra whitespace
  const titleText = footerTitle.trim().replace(/^\s*\n+|\n+\s*$/g, '');

  const escapedTitleText = titleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFooterText = [footerFooter, legacyFooterFooter]
    .map((text) => text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // Strip every existing footer block (and the blank lines before it), wherever
  // it sits in the body — not just at the very end. Anchoring to end-of-body
  // meant that if a bot appended content after the footer, we couldn't find the
  // old footer and appended a second one (duplicate). Removing all of them and
  // re-appending a single footer keeps exactly one, and preserves any other
  // content (e.g. bot sections) that followed it.
  const footerBlock = new RegExp(
    `\\s*${escapedTitleText}[\\s\\S]*?(?:${escapedFooterText})`,
    'g'
  );

  return body.replace(footerBlock, '').trimEnd() + footer;
}

function filterFrozenBranches(
  branches: readonly string[],
  context: TContext
): string[] {
  return branches.filter((branch) => {
    if (!context.engine.isBranchFrozen(branch)) return true;
    context.splog.info(`Skipping frozen branch ${branch}.`);
    return false;
  });
}

async function selectBranches(
  context: TContext,
  branchNames: string[]
): Promise<string[]> {
  const result = [];
  for (const branchName of branchNames) {
    if (!filterFrozenBranches([branchName], context).length) continue;
    const selected = (
      await context.prompts({
        name: 'value',
        initial: true,
        type: 'confirm',
        message: `Would you like to submit ${chalk.cyan(branchName)}?`,
      })
    ).value;
    // Clear the prompt result
    process.stdout.moveCursor(0, -1);
    process.stdout.clearLine(1);
    if (selected) {
      result.push(branchName);
    }
  }
  return result;
}

async function shouldAbort(
  args: { dryRun: boolean; confirm: boolean; hasAnyPrs: boolean },
  context: TContext
): Promise<boolean> {
  if (args.dryRun) {
    context.splog.info(chalk.blueBright('✅ Dry run complete.'));
    return true;
  }

  if (!args.hasAnyPrs) {
    context.splog.info(chalk.blueBright('🆗 All PRs up to date.'));
    return true;
  }

  if (
    context.canPrompt &&
    args.confirm &&
    !(
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: 'Continue with this submit operation?',
        initial: true,
      })
    ).value
  ) {
    context.splog.info(chalk.blueBright('🛑 Aborted submit.'));
    throw new KilledError();
  }

  return false;
}
