import chalk from 'chalk';
import { execFileSync } from 'child_process';
import { githubRepoSlug } from '../../lib/api/github_repo';
import { TContext } from '../../lib/context';
import { getSha } from '../../lib/git/get_sha';
import {
  ExitFailedError,
  KilledError,
  RebaseConflictError,
} from '../../lib/errors';
import { uncommittedTrackedChangesPrecondition } from '../../lib/preconditions';
import { assertUnreachable } from '../../lib/utils/assert_unreachable';
import { persistContinuation } from '../persist_continuation';
import { printConflictStatus } from '../print_conflict_status';

export async function getAction(
  args: { branchName: string | undefined; force: boolean; unfrozen: boolean },
  context: TContext
): Promise<void> {
  const trunk = context.engine.trunk;
  const repo = githubRepoSlug(context);

  let target = args.branchName ?? context.engine.currentBranch;
  if (!target) {
    throw new ExitFailedError(
      'No branch or PR specified, and no current branch to get.'
    );
  }

  // A numeric argument is a PR number; resolve it to its head branch.
  if (/^\d+$/.test(target)) {
    target = prFieldOrThrow(target, 'headRefName', repo);
  }

  if (target === trunk) {
    context.splog.info(`Nothing to get: ${chalk.cyan(trunk)} is trunk.`);
    return;
  }

  // Charcoal doesn't push branch metadata to the remote, so we reconstruct the
  // downstack chain (trunk -> target) by walking each PR's base ref.
  const downstack: string[] = [];
  const seen = new Set<string>();
  let branch: string | undefined = target;
  while (branch && branch !== trunk) {
    if (seen.has(branch)) {
      throw new ExitFailedError(
        `Encountered a cycle while resolving the stack for ${chalk.yellow(
          target
        )}.`
      );
    }
    seen.add(branch);
    downstack.unshift(branch);
    branch = prFieldMaybe(branch, 'baseRefName', repo);
  }

  if (branch !== trunk) {
    throw new ExitFailedError(
      [
        `Could not trace ${chalk.yellow(target)} back to trunk (${chalk.cyan(
          trunk
        )}) from its pull requests.`,
        `\`ch get\` reconstructs a stack from open PRs, so every branch from trunk to ${chalk.yellow(
          target
        )} needs one.`,
      ].join('\n')
    );
  }

  const updatedBranches = await getBranchesFromRemote(
    {
      downstack,
      base: trunk,
      force: args.force,
      importDecisions: decideImports(downstack, args.unfrozen, context),
    },
    context
  );

  try {
    context.engine.checkoutBranch(target, { preserveIgnored: true });
  } catch (error) {
    if (updatedBranches.length > 0) {
      throw new ExitFailedError(
        `Updated ${updatedBranches.join(
          ', '
        )} before get stopped. Final checkout of ${target} failed.\n${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    throw error;
  }
}

function prFieldMaybe(
  branchOrNumber: string,
  field: 'headRefName' | 'baseRefName',
  repo: string
): string | undefined {
  try {
    const pr = JSON.parse(
      execFileSync(
        'gh',
        ['pr', 'view', branchOrNumber, '--repo', repo, '--json', field],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      ).toString()
    );
    return pr[field] || undefined;
  } catch {
    return undefined;
  }
}

function prFieldOrThrow(
  branchOrNumber: string,
  field: 'headRefName' | 'baseRefName',
  repo: string
): string {
  const value = prFieldMaybe(branchOrNumber, field, repo);
  if (!value) {
    throw new ExitFailedError(
      `Could not find an open pull request for "${branchOrNumber}".`
    );
  }
  return value;
}

export type GetImportDecision = {
  branchName: string;
  wasTracked: boolean;
  frozen: boolean;
};

function optionalGhJson(args: string[]): unknown {
  try {
    return JSON.parse(
      execFileSync('gh', args, {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString()
    );
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function trustedLogin(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const login = value.login;
  return typeof login === 'string' &&
    /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login) &&
    !login.includes('--')
    ? login.toLowerCase()
    : undefined;
}

function decideImports(
  downstack: string[],
  unfrozen: boolean,
  context: TContext
): GetImportDecision[] {
  const newBranches = downstack.filter(
    (name) => !getSha(`refs/branch-metadata/${name}`)
  );
  const account =
    !unfrozen && newBranches.length > 0
      ? trustedLogin(optionalGhJson(['api', 'user']))
      : undefined;
  const repo = githubRepoSlug(context);
  return downstack.map((branchName) => {
    const wasTracked = !newBranches.includes(branchName);
    if (wasTracked)
      return {
        branchName,
        wasTracked,
        frozen: context.engine.isBranchFrozen(branchName),
      };
    const pr =
      !unfrozen && account
        ? optionalGhJson([
            'pr',
            'view',
            branchName,
            '--repo',
            repo,
            '--json',
            'author',
          ])
        : undefined;
    const author = isObject(pr) ? trustedLogin(pr.author) : undefined;
    return {
      branchName,
      wasTracked,
      frozen: !unfrozen && (!account || author !== account),
    };
  });
}

export async function getBranchesFromRemote(
  args: {
    downstack: string[];
    base: string;
    force: boolean;
    importDecisions?: GetImportDecision[];
  },
  context: TContext
): Promise<string[]> {
  const updatedBranches: string[] = [];
  let incompleteBranch: string | undefined;
  try {
    let parentBranchName = args.base;
    for (const [index, branchName] of args.downstack.entries()) {
      const decision = args.importDecisions?.find(
        (item) => item.branchName === branchName
      );
      const importFrozen =
        decision &&
        !decision.wasTracked &&
        !getSha(`refs/branch-metadata/${branchName}`)
          ? decision.frozen
          : undefined;
      const previousRevision = getSha(`refs/heads/${branchName}`);
      const previousMetadata = getSha(`refs/branch-metadata/${branchName}`);
      let completed = false;
      try {
        context.engine.fetchBranch(branchName, parentBranchName);
        if (
          args.force ||
          !context.engine.branchExists(branchName) ||
          !context.engine.branchMatchesFetched(branchName)
        ) {
          uncommittedTrackedChangesPrecondition();
        }
        if (
          context.engine.branchExists(branchName) &&
          context.engine.isBranchTracked(branchName) &&
          context.engine.getParentPrecondition(branchName) ===
            parentBranchName &&
          context.engine.branchMatchesFetched(branchName)
        ) {
          context.splog.info(`${chalk.cyan(branchName)} is up to date.`);
        } else if (args.force || !context.engine.branchExists(branchName)) {
          context.engine.checkoutBranchFromFetched(
            branchName,
            parentBranchName,
            importFrozen
          );
          context.splog.info(`Synced ${chalk.cyan(branchName)} from remote.`);
        } else if (!context.engine.isBranchTracked(branchName)) {
          await handleUntrackedLocally(
            { branchName, parentBranchName, importFrozen },
            context
          );
        } else if (
          context.engine.getParentPrecondition(branchName) !== parentBranchName
        ) {
          await handleDifferentParents(branchName, parentBranchName, context);
        } else if (
          context.engine.fastForwardBranchFromFetched(
            branchName,
            parentBranchName
          )
        ) {
          context.splog.info(`Synced ${chalk.cyan(branchName)} from remote.`);
          if (context.engine.getChildren(branchName).length > 0) {
            context.splog.info('Local children may need to be restacked.');
          }
        } else {
          const remainingBranchesToSync = args.downstack.slice(index + 1);
          await handleSameParent(
            {
              branchName,
              parentBranchName,
              remainingBranchesToSync,
              importDecisions: args.importDecisions,
            },
            context
          );
        }
        completed = true;
      } finally {
        if (
          getSha(`refs/heads/${branchName}`) !== previousRevision ||
          getSha(`refs/branch-metadata/${branchName}`) !== previousMetadata
        ) {
          updatedBranches.push(branchName);
          if (!completed) incompleteBranch = branchName;
        }
      }
      parentBranchName = branchName;
    }
  } catch (error) {
    if (updatedBranches.length > 0) {
      throw new ExitFailedError(
        `Updated ${updatedBranches.join(', ')} before get stopped.\n${
          incompleteBranch
            ? `Metadata/status publication for ${incompleteBranch} may be incomplete.\n`
            : ''
        }${error instanceof Error ? error.message : String(error)}`
      );
    }
    throw error;
  }
  return updatedBranches;
}

async function handleUntrackedLocally(
  args: {
    branchName: string;
    parentBranchName: string;
    importFrozen?: boolean;
  },
  context: TContext
): Promise<void> {
  const { branchName, parentBranchName } = args;
  context.splog.info(
    [
      `${chalk.yellow(
        branchName
      )} shares a name with a local branch that is not tracked by Charcoal.`,
      `In order to sync it, you must overwrite your local copy of the branch.`,
      `If you do not wish to overwrite your copy, the command will be aborted.`,
    ].join('\n')
  );
  await maybeOverwriteBranch(
    { branchName, parentBranchName, importFrozen: args.importFrozen },
    context
  );
}

async function handleDifferentParents(
  branchName: string,
  parentBranchName: string,
  context: TContext
): Promise<void> {
  context.splog.info(
    [
      `${chalk.yellow(
        branchName
      )} shares a name with a local branch, but they have different parents.`,
      `In order to sync it, you must overwrite your local copy of the branch.`,
      `If you do not wish to overwrite your copy, the command will be aborted.`,
    ].join('\n')
  );
  await maybeOverwriteBranch({ branchName, parentBranchName }, context);
}

// Helper function for cases where we can either overwrite local or abort
async function maybeOverwriteBranch(
  args: {
    branchName: string;
    parentBranchName: string;
    importFrozen?: boolean;
  },
  context: TContext
): Promise<void> {
  const { branchName, parentBranchName } = args;
  if (!context.interactive) {
    throw new ExitFailedError(
      `Cannot overwrite local branch ${branchName} without confirmation in non-interactive mode. Retry interactively, or use --force to overwrite it with the remote version.`
    );
  }
  if (
    !(
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: `Overwrite ${chalk.yellow(
          branchName
        )} with the version from remote?`,
        initial: false,
      })
    ).value
  ) {
    throw new KilledError();
  }

  context.engine.checkoutBranchFromFetched(
    branchName,
    parentBranchName,
    args.importFrozen
  );
  context.splog.info(`Synced ${chalk.cyan(branchName)} from remote.`);
}

// This is the most complex case - if the branch's parent matches meta,
// we need to not only allow for overwrite and abort, but also rebasing
// local changes onto the changes from remote.
async function handleSameParent(
  args: {
    branchName: string;
    parentBranchName: string;
    remainingBranchesToSync: string[];
    importDecisions?: GetImportDecision[];
  },
  context: TContext
): Promise<void> {
  const frozen = context.engine.isBranchFrozen(args.branchName);
  context.splog.info(
    [
      `${chalk.yellow(
        args.branchName
      )} shares a name with a local branch, and they have the same parent.`,
      frozen
        ? `This branch is frozen. Use ch unfreeze ${args.branchName} before rebasing local changes, or explicitly overwrite it with the remote version.`
        : `You can either overwrite your copy of the branch, or rebase your local changes onto the remote version.`,
      `You can also abort the command entirely and keep your local state as is.`,
    ].join('\n')
  );

  const fetchChoice: 'REBASE' | 'OVERWRITE' | 'ABORT' = !context.interactive
    ? 'ABORT'
    : (
        await context.prompts({
          type: 'select',
          name: 'value',
          message: `How would you like to handle ${chalk.yellow(
            args.branchName
          )}?`,
          choices: [
            ...(frozen
              ? []
              : [
                  {
                    title: 'Rebase your changes on top of the remote version',
                    value: 'REBASE',
                  },
                ]),
            {
              title: 'Overwrite the local copy with the remote version',
              value: 'OVERWRITE',
            },
            { title: 'Abort this command', value: 'ABORT' },
          ],
        })
      ).value;

  switch (fetchChoice) {
    case 'REBASE': {
      const result = context.engine.rebaseBranchOntoFetched(args.branchName);
      if (result.result === 'REBASE_CONFLICT') {
        persistContinuation(
          {
            branchesToSync: args.remainingBranchesToSync,
            getImportDecisions: args.importDecisions,
            rebasedBranchBase: result.rebasedBranchBase,
          },
          context
        );
        printConflictStatus(
          `Hit conflict rebasing ${chalk.yellow(
            args.branchName
          )} onto remote source of truth.`,
          context
        );
        throw new RebaseConflictError();
      }
      context.splog.info(
        `Rebased local changes to ${chalk.cyan(
          args.branchName
        )} onto remote source of truth.`
      );
      context.splog.tip(
        `If this branch has local children, they likely need to be restacked.`
      );
      break;
    }
    case 'OVERWRITE':
      context.engine.checkoutBranchFromFetched(
        args.branchName,
        args.parentBranchName
      );
      context.splog.info(`Synced ${chalk.cyan(args.branchName)} from remote.`);
      break;
    case 'ABORT':
      if (!context.interactive) {
        throw new ExitFailedError(
          `Local branch ${args.branchName} has diverged from remote.${
            frozen
              ? ` It is frozen; use ch unfreeze ${args.branchName} before rebasing local changes.`
              : ''
          } Retry interactively to choose a resolution, or use --force to overwrite it with the remote version.`
        );
      }
      throw new KilledError();
    default:
      assertUnreachable(fetchChoice);
  }
}
