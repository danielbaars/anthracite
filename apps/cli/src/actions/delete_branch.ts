import chalk from 'chalk';
import { getGithubPr, GithubPr } from '../lib/api/github_pr';
import { runGitCommand } from '../lib/git/runner';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { ExitFailedError } from '../lib/errors';
import { getBranchesToRestack, restackBranches } from './restack';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { clearContinuation } from './persist_continuation';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { getSha } from '../lib/git/get_sha';

type TDeleteArgs = { branchName: string; force?: boolean };
// Preflight and execution use different contexts within the same CLI process.
const verifiedDeleteWork = new Map<
  string,
  { readonly head: string; readonly metadata: string }
>();

/** Verify PR authority before ordinary context repair or local deletion. */
export async function prepareDelete(
  args: TDeleteArgs,
  context: TContext
): Promise<void> {
  verifiedDeleteWork.delete(args.branchName);
  // Local participant protection must refuse before any remote read or cache write.
  assertDeleteAllowed({ ...args, force: true }, context);
  if (args.force) return;
  const cached = context.engine.getPrInfo(args.branchName);
  const locallySafe =
    context.engine.isMergedIntoTrunk(args.branchName) ||
    context.engine.isBranchEmpty(args.branchName);
  if (locallySafe) return;
  if (cached?.number === undefined) {
    if (cached?.state)
      throw new ExitFailedError(
        `The branch ${args.branchName} has last known ${cached.state} (cached; age unknown), but no associated PR number. Could not verify its current GitHub state.`
      );
    assertDeleteAllowed(args, context);
    return;
  }
  const before = deleteGraphState();
  let pr: GithubPr | undefined;
  try {
    if (!context.repoConfig.getIsGithubIntegrationEnabled())
      throw new ExitFailedError('GitHub integration is disabled.');
    pr = await getGithubPr(args.branchName, context);
    if (!pr) throw new ExitFailedError('The associated PR was not found.');
  } catch (error: unknown) {
    throw new ExitFailedError(
      `The branch ${args.branchName} has PR #${cached.number}, last known ${
        cached.state ?? 'UNKNOWN'
      } (cached; age unknown). Could not verify its current GitHub state. ${
        error instanceof Error ? error.message : 'PR information unavailable.'
      }`
    );
  }
  if (before !== deleteGraphState())
    throw new ExitFailedError(
      'Branches or metadata changed while verifying PR state; deletion refused. Retry after inspecting the local stack.'
    );
  assertDeleteAllowed({ ...args, force: true }, context);
  if (
    pr.state !== 'OPEN' &&
    pr.headRefOid !== getSha(`refs/heads/${args.branchName}`)
  )
    throw new ExitFailedError(
      `PR #${
        pr.number
      } is ${pr.state.toLowerCase()} but does not cover the current local head of ${
        args.branchName
      }. Local commits are retained; inspect them before explicitly using delete --force.`
    );
  // Retain the verified state even when an open/reopened PR refuses deletion.
  context.engine.upsertPrInfo(args.branchName, {
    state: pr.state,
    base: pr.baseRefName,
  });
  if (pr.state !== 'OPEN')
    verifiedDeleteWork.set(args.branchName, {
      head: pr.headRefOid,
      metadata: getSha(`refs/branch-metadata/${args.branchName}`),
    });
  assertDeleteAllowed(args, context);
}

function deleteGraphState(): string {
  return runGitCommand({
    args: [
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/branch-metadata',
    ],
    onError: 'throw',
    resource: 'deleteGraphState',
  });
}

/** Deletion may remove a frozen target, but surviving mandatory edits may not. */
export function assertDeleteAllowed(
  args: TDeleteArgs,
  context: TContext
): void {
  if (context.engine.isTrunk(args.branchName)) {
    throw new ExitFailedError('Cannot delete trunk!');
  }
  if (!args.force && !isSafeToDelete(args.branchName, context).result) {
    if (
      ['CLOSED', 'MERGED'].includes(
        context.engine.getPrInfo(args.branchName)?.state ?? ''
      )
    )
      throw new ExitFailedError(
        `The terminal PR does not cover the current local head or metadata of ${args.branchName}; its local work is retained. Inspect before explicitly using delete --force.`
      );
    throw new ExitFailedError(
      [
        `The branch ${args.branchName} is neither merged nor closed.  Use the \`--force\` option to delete it.`,
        `Note that its changes will be lost, as its children will be restacked onto its parent.`,
      ].join('\n')
    );
  }
  const plan = getDeleteSurvivors(args.branchName, context);
  for (const branch of plan.mandatory)
    context.engine.assertBranchEditable(branch);
  if (plan.replay.length) assertNoGitOperation('delete');
  assertBranchesAvailableInWorktrees([args.branchName, ...plan.replay]);
}

export function getDeleteSurvivors(
  branchName: string,
  context: TContext,
  deleting: readonly string[] = [branchName]
): { mandatory: string[]; replay: string[] } {
  const upstack = context.engine.getRelativeStack(branchName, SCOPE.UPSTACK);
  const removed = new Set(
    deleting.filter((branch) => upstack.includes(branch))
  );
  const descendants = upstack.filter(
    (branch) => branch !== branchName && !removed.has(branch)
  );
  const parents = new Map<string, string>();
  for (const branch of descendants) {
    const parent = context.engine.getParentPrecondition(branch);
    let survivor = parent;
    while (removed.has(survivor))
      survivor = context.engine.getParentPrecondition(survivor);
    if (parent !== survivor) parents.set(branch, survivor);
  }
  const replay = getBranchesToRestack(descendants, context, { parents });
  return { mandatory: [...new Set([...parents.keys(), ...replay])], replay };
}

export function deleteBranchAction(args: TDeleteArgs, context: TContext): void {
  assertDeleteAllowed(args, context);
  const branchesToRestack = context.engine.getRelativeStack(
    args.branchName,
    SCOPE.UPSTACK_EXCLUSIVE
  );
  const plan = getDeleteSurvivors(args.branchName, context);
  const mandatory = plan.mandatory;
  const departure = context.engine.currentBranch;
  context.engine.deleteBranch(
    args.branchName,
    () => {
      try {
        for (const branch of mandatory)
          context.engine.assertBranchEditable(branch);
        assertDeleteAllowed(args, context);
      } catch (error) {
        if (
          context.engine.currentBranch !== departure &&
          error instanceof Error
        )
          throw new ExitFailedError(
            `${error.message}\nChecked out ${context.engine.currentBranch}; ${args.branchName} has not been deleted. Completed metadata changes are retained.`
          );
        throw error;
      }
    },
    mandatory
  );
  context.splog.info(`Deleted branch ${chalk.red(args.branchName)}`);
  if (plan.replay.length === 0) return;
  context.continueConfig.update((data) => {
    data.delete = { branch: args.branchName, mandatory };
    data.branchesToRestack = [...branchesToRestack];
    data.branchesToSync = [];
  });
  restackBranches(branchesToRestack, context);
  clearContinuation(context);
}

// Where did we merge this? If it was merged on GitHub, we see where it was
// merged into. If we don't detect that it was merged in GitHub but we do
// see the code in trunk, we fallback to say that it was merged into trunk.
// This extra check (rather than just saying trunk) is used to catch the
// case where one feature branch is merged into another on GitHub.
export function isSafeToDelete(
  branchName: string,
  context: TContext
): { result: true; reason: string } | { result: false } {
  const prInfo = context.engine.getPrInfo(branchName);
  const verified = verifiedDeleteWork.get(branchName);
  const covered =
    verified !== undefined &&
    verified.head === getSha(`refs/heads/${branchName}`) &&
    verified.metadata === getSha(`refs/branch-metadata/${branchName}`);

  const reason =
    covered && prInfo?.state === 'CLOSED'
      ? `${chalk.redBright(branchName)} is closed on GitHub`
      : covered && prInfo?.state === 'MERGED'
      ? `${chalk.green(branchName)} is merged into ${chalk.cyan(
          prInfo?.base ?? context.engine.trunk
        )}`
      : context.engine.isMergedIntoTrunk(branchName)
      ? `${chalk.green(branchName)} is merged into ${chalk.cyan(
          context.engine.trunk
        )}`
      : context.engine.isBranchEmpty(branchName)
      ? `${chalk.yellow(branchName)} is empty`
      : undefined;

  return reason ? { result: true, reason } : { result: false };
}
