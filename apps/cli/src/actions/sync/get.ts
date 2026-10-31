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
import { captureGetCheckout, finishGetCheckout } from './get_checkout';
import { getMergeBase } from '../../lib/git/merge_base';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import {
  activateRemoteUpdateNode,
  assertRemoteUpdateNodeUnchanged,
  getPullRequest,
  selectRemoteUpdateGraph,
  snapshotRemoteUpdateGraph,
  releaseRemoteUpdateGraph,
  RemoteUpdateNode,
} from './remote_update_graph';

import {
  RemoteTrunkUpdate,
  snapshotRemoteTrunk,
  assertRemoteTrunkUnchanged,
  applyRemoteTrunk,
  releaseRemoteTrunk,
} from './remote_update_trunk';

export async function getAction(
  args: {
    branchName: string | undefined;
    force: boolean;
    unfrozen: boolean;
    downstack?: boolean;
    checkout?: boolean;
  },
  context: TContext
): Promise<void> {
  const original = captureGetCheckout();
  const trunk = context.engine.trunk;
  let target =
    args.branchName ??
    ('branchName' in original ? original.branchName : undefined);
  if (!target) {
    throw new ExitFailedError(
      'No branch or PR specified, and no current branch to get.'
    );
  }

  // Keep the requested PR's full identity pinned through branch graph discovery.
  const requestedPr = /^\d+$/.test(target)
    ? getPullRequest(target, context)
    : undefined;
  if (requestedPr) target = requestedPr.headRefName;

  if (target === trunk) {
    context.splog.info(`Nothing to get: ${chalk.cyan(trunk)} is trunk.`);
    return;
  }

  const selected = selectRemoteUpdateGraph(
    target,
    args.downstack ?? false,
    context
  );
  const targetSource = selected.find((node) => node.branchName === target);
  if (
    requestedPr &&
    (targetSource?.pullRequestNumber !== requestedPr.number ||
      targetSource.expectedSourceHead !== requestedPr.headRefOid ||
      targetSource.parentBranchName !== requestedPr.baseRefName)
  )
    throw new ExitFailedError(
      `Pull request identity for ${target} changed while planning get. Please retry.`
    );
  const remoteTrunk = snapshotRemoteTrunk(context);
  let nodes: RemoteUpdateNode[] = [];
  try {
    nodes = snapshotRemoteUpdateGraph(selected, context, remoteTrunk);
    await prepareRemoteUpdates(
      {
        nodes,
        force: args.force,
        target,
        trunk: remoteTrunk,
        finalBranch:
          args.checkout === false
            ? 'branchName' in original
              ? original.branchName
              : undefined
            : target,
      },
      context
    );
  } catch (error) {
    releaseRemoteUpdateGraph(nodes);
    releaseRemoteTrunk(remoteTrunk);
    throw error;
  }
  let updatedBranches: string[];
  const completedFeatures: string[] = [];
  let phase = 'trunk fast-forward';
  try {
    applyRemoteTrunk(remoteTrunk, context);
    phase = 'remote refresh';
    updatedBranches = await getBranchesFromRemote(
      {
        downstack: nodes.map((node) => node.branchName),
        base: trunk,
        force: args.force,
        importDecisions: decideImports(
          nodes.map((node) => node.branchName),
          args.unfrozen,
          context
        ),
        nodes,
        onComplete: (branch) => {
          completedFeatures.push(branch);
        },
      },
      context
    );
    if (remoteTrunk.head !== remoteTrunk.previousHead)
      updatedBranches.unshift(trunk);
  } catch (error) {
    const reached = getSha(`refs/heads/${trunk}`) !== remoteTrunk.previousHead;
    if (reached)
      throw new ExitFailedError(
        `Trunk ${trunk} reached ${getSha(
          `refs/heads/${trunk}`
        )} before get stopped during ${phase}.\nCompleted feature refresh: ${
          completedFeatures.join(', ') || 'none'
        }.\nPending feature refresh: ${
          nodes
            .filter((node) => !completedFeatures.includes(node.branchName))
            .map((node) => node.branchName)
            .join(', ') || 'none'
        }.\n${error instanceof Error ? error.message : String(error)}`
      );
    throw error;
  }
  releaseRemoteUpdateGraph(nodes);
  releaseRemoteTrunk(remoteTrunk);

  finishGetCheckout(
    { target, original, shouldCheckout: args.checkout ?? true },
    updatedBranches
  );
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
    nodes?: readonly RemoteUpdateNode[];
    onComplete?: (branchName: string) => void;
  },
  context: TContext
): Promise<string[]> {
  const updatedBranches: string[] = [];
  let incompleteBranch: string | undefined;
  try {
    let parentBranchName = args.base;
    for (const [index, branchName] of args.downstack.entries()) {
      const node = args.nodes?.find((item) => item.branchName === branchName);
      if (node) parentBranchName = node.parentBranchName;
      const decision = args.importDecisions?.find(
        (item) => item.branchName === branchName
      );
      const importFrozen = getImportFrozen(branchName, decision);
      const previousRevision = getSha(`refs/heads/${branchName}`);
      const previousMetadata = getSha(`refs/branch-metadata/${branchName}`);
      let completed = false;
      try {
        if (node) activateGuardedRemoteNode(node, context);
        else context.engine.fetchBranch(branchName, parentBranchName);
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
        } else if (
          node?.resolution === 'OVERWRITE' ||
          args.force ||
          !context.engine.branchExists(branchName)
        ) {
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
          context.engine.getParentPrecondition(branchName) !==
            parentBranchName &&
          node?.resolution !== 'UPDATE'
        ) {
          await handleDifferentParents(branchName, parentBranchName, context);
        } else if (
          context.engine.fastForwardBranchFromFetched(
            branchName,
            parentBranchName,
            node
              ? { number: node.pullRequestNumber, url: node.pullRequestUrl }
              : undefined
          )
        ) {
          context.splog.info(`Synced ${chalk.cyan(branchName)} from remote.`);
          if (context.engine.getChildren(branchName).length > 0) {
            context.splog.info('Local children may need to be restacked.');
          }
        } else {
          const remainingBranchesToSync = continuationBranches(args, index);
          await handleSameParent(
            {
              branchName,
              parentBranchName,
              remainingBranchesToSync,
              importDecisions: args.importDecisions,
              fetchChoice: node?.resolution === 'REBASE' ? 'REBASE' : undefined,
            },
            context
          );
        }
        completed = true;
        args.onComplete?.(branchName);
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

function activateGuardedRemoteNode(
  node: RemoteUpdateNode,
  context: TContext
): void {
  if (node.resolution === 'REBASE')
    context.engine.assertBranchEditable(node.branchName);
  assertRemoteUpdateNodeUnchanged(node);
  activateRemoteUpdateNode(node);
  assertRemoteUpdateNodeUnchanged(node);
}

function getImportFrozen(
  branchName: string,
  decision: GetImportDecision | undefined
): boolean | undefined {
  return decision &&
    !decision.wasTracked &&
    !getSha(`refs/branch-metadata/${branchName}`)
    ? decision.frozen
    : undefined;
}

function continuationBranches(
  args: { downstack: readonly string[]; nodes?: readonly RemoteUpdateNode[] },
  index: number
): string[] {
  if (
    args.nodes &&
    args.nodes
      .slice(index + 1)
      .some(
        (pending, offset) =>
          pending.parentBranchName !== args.downstack[index + offset]
      )
  ) {
    throw new ExitFailedError(
      'Graph reconciliation requires graph-aware continuation. Pending remote updates remain pinned; inspect the selected branches before retrying.'
    );
  }
  return args.downstack.slice(index + 1);
}

async function prepareRemoteUpdates(
  args: {
    nodes: readonly RemoteUpdateNode[];
    force: boolean;
    target: string;
    trunk?: RemoteTrunkUpdate;
    finalBranch: string | undefined;
  },
  context: TContext
): Promise<void> {
  if (args.trunk) assertRemoteTrunkUnchanged(args.trunk);
  for (const node of args.nodes) assertRemoteUpdateNodeUnchanged(node);
  const changing = args.nodes.filter(
    (node) =>
      args.force ||
      getSha(`refs/heads/${node.branchName}`) !== node.head ||
      !context.engine.branchExists(node.branchName) ||
      !context.engine.isBranchTracked(node.branchName) ||
      context.engine.getParentPrecondition(node.branchName) !==
        node.parentBranchName
  );
  const advancingTrunk =
    args.trunk && args.trunk.head !== args.trunk.previousHead;
  if (changing.length > 0 || advancingTrunk)
    uncommittedTrackedChangesPrecondition();
  assertBranchesAvailableInWorktrees([
    ...changing.map((node) => node.branchName),
    args.target,
    ...(args.finalBranch ? [args.finalBranch] : []),
  ]);
  assertRestackFilesAvailable({
    branches: [],
    checkoutRevisions: [
      ...args.nodes.map((node) => node.head),
      ...(advancingTrunk && args.trunk ? [args.trunk.head] : []),
    ],
    operation: 'get',
  });
  for (const node of changing) {
    const exists = context.engine.branchExists(node.branchName);
    if (args.force || !exists) {
      node.resolution = 'OVERWRITE';
      continue;
    }
    if (
      context.engine.isBranchTracked(node.branchName) &&
      node.previousParentBranchName !== node.parentBranchName &&
      getMergeBase(node.previousHead, node.head) === node.previousHead
    ) {
      node.resolution = 'UPDATE';
    } else if (
      !context.engine.isBranchTracked(node.branchName) ||
      context.engine.getParentPrecondition(node.branchName) !==
        node.parentBranchName
    ) {
      context.splog.info(
        context.engine.isBranchTracked(node.branchName)
          ? `${node.branchName} and its remote source have different parents.`
          : `${node.branchName} is not tracked by Anthracite.`
      );
      await confirmOverwriteBranch(node.branchName, context);
      node.resolution = 'OVERWRITE';
    } else if (
      getMergeBase(node.branchName, node.head) !==
      getSha(`refs/heads/${node.branchName}`)
    ) {
      node.resolution = await chooseRemoteResolution(node.branchName, context);
      if (node.resolution === 'REBASE')
        continuationBranches(
          {
            downstack: args.nodes.map((item) => item.branchName),
            nodes: args.nodes,
          },
          args.nodes.indexOf(node)
        );
    }
  }
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
      )} shares a name with a local branch that is not tracked by Anthracite.`,
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
  await confirmOverwriteBranch(branchName, context);

  context.engine.checkoutBranchFromFetched(
    branchName,
    parentBranchName,
    args.importFrozen
  );
  context.splog.info(`Synced ${chalk.cyan(branchName)} from remote.`);
}

async function confirmOverwriteBranch(
  branchName: string,
  context: TContext
): Promise<void> {
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
}

type RemoteResolution = 'REBASE' | 'OVERWRITE';

async function chooseRemoteResolution(
  branchName: string,
  context: TContext
): Promise<RemoteResolution> {
  const frozen = context.engine.isBranchFrozen(branchName);
  context.splog.info(
    [
      `${chalk.yellow(
        branchName
      )} shares a name with a local branch, and they have the same parent.`,
      frozen
        ? `This branch is frozen. Use an unfreeze ${branchName} before rebasing local changes, or explicitly overwrite it with the remote version.`
        : `You can either overwrite your copy of the branch, or rebase your local changes onto the remote version.`,
      `You can also abort the command entirely and keep your local state as is.`,
    ].join('\n')
  );

  const fetchChoice: RemoteResolution | 'ABORT' = !context.interactive
    ? 'ABORT'
    : (
        await context.prompts({
          type: 'select',
          name: 'value',
          message: `How would you like to handle ${chalk.yellow(branchName)}?`,
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

  if (fetchChoice === 'ABORT') {
    if (!context.interactive)
      throw new ExitFailedError(
        `Local branch ${branchName} has diverged from remote.${
          frozen
            ? ` It is frozen; use an unfreeze ${branchName} before rebasing local changes.`
            : ''
        } Retry interactively to choose a resolution, or use --force to overwrite it with the remote version.`
      );
    throw new KilledError();
  }
  return fetchChoice;
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
    fetchChoice?: RemoteResolution;
  },
  context: TContext
): Promise<void> {
  const fetchChoice =
    args.fetchChoice ??
    (await chooseRemoteResolution(args.branchName, context));

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
    default:
      assertUnreachable(fetchChoice);
  }
}
