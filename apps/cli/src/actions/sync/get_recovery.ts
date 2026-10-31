import fs from 'fs';
import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { z } from 'zod';
import path from 'path';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { getRepoRootPathPrecondition } from '../../lib/preconditions';
import { runGitCommand } from '../../lib/git/runner';
import { getSha } from '../../lib/git/get_sha';
import { getCurrentBranchName } from '../../lib/git/branch_ops';
import { getRebaseDirectory } from '../../lib/git/rebase_in_progress';
import { getRebaseHead } from '../../lib/git/merge_conflict_help';
import {
  ownsRebase,
  readRebaseIntentDigest,
} from '../../lib/git/rebase_ownership';
import { gitEnvironmentOverrides } from '../../lib/git/environment_overrides';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertBranchEditable } from '../../lib/engine/frozen_branch';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import {
  continueConfigFactory,
  TContinueConfig,
} from '../../lib/spiffy/continuation_spf';
import { repoConfigFactory } from '../../lib/spiffy/repo_config_spf';
import { GetOperation, getOperationSchema } from './get_operation';

const savedRecords = new WeakMap<TContinueConfig, string>();
export function assertGetRecoveryWrite(context: TContext): void {
  const previous = savedRecords.get(context.continueConfig);
  if (
    (previous === undefined && fs.existsSync(context.continueConfig.path)) ||
    (previous !== undefined &&
      (!fs.existsSync(context.continueConfig.path) ||
        fs.readFileSync(context.continueConfig.path, 'utf8') !== previous))
  )
    refuseGet(
      'Saved get ownership changed on disk; foreign recovery must be inspected.',
      context.continueConfig.data.get
    );
}
export function recordGetRecoveryWrite(context: TContext): void {
  if (context.continueConfig.data.get)
    savedRecords.set(
      context.continueConfig,
      fs.readFileSync(context.continueConfig.path, 'utf8')
    );
}

const gitPath = (...args: string[]): string =>
  runGitCommand({ args, onError: 'throw', resource: 'getRecovery' });
export function getRecoveryDigest(data: TContinueConfig['data']): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...data, rebaseOwnership: undefined }))
    .digest('hex');
}
export function getRecoveryFile(): string {
  return path.join(getRepoRootPathPrecondition(), '.gtcontinue');
}
export function getRecoveryIdentity(): {
  root: string;
  commonDirectory: string;
  gitDirectory: string;
} {
  return {
    root: fs.realpathSync(gitPath('rev-parse', '--show-toplevel')),
    commonDirectory: fs.realpathSync(
      gitPath('rev-parse', '--path-format=absolute', '--git-common-dir')
    ),
    gitDirectory: fs.realpathSync(gitPath('rev-parse', '--absolute-git-dir')),
  };
}
function refuseGet(reason: string, operation?: GetOperation): never {
  throw new ExitFailedError(
    `${reason} Get recovery preserved${
      operation ? ` in ${operation.root}` : ''
    }. Inspect git status, git log and saved .gtcontinue in the original project; raw git rebase --abort cancels only its active rebase, not completed updates. Do not advance an unverified queue.`
  );
}

/** Run before ordinary context loading can repair or discard an owned record. */
export function preflightGetRecovery(command: string): boolean {
  const file = getRecoveryFile();
  if (!fs.existsSync(file)) {
    if (readRebaseIntentDigest())
      refuseGet(
        'Active get intent is missing; recover its original saved record before continuing.'
      );
    return false;
  }
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuseGet('Malformed continuation JSON.');
  }
  if (typeof value !== 'object' || value === null || !('get' in value)) {
    if (readRebaseIntentDigest())
      refuseGet(
        'Active get intent is missing; recover its original saved record before continuing.'
      );
    return false;
  }
  const envelope = getOperationSchema.safeParse(value.get);
  if (!envelope.success) refuseGet('Incompatible or malformed get intent.');
  const allowed = new Set([
    'get',
    'branchesToSync',
    'branchesToRestack',
    'getImportDecisions',
    'currentBranchOverride',
    'rebasedBranchBase',
    'rebaseOwnership',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    refuseGet('Get intent overlaps foreign recovery fields.', envelope.data);
  if (command !== 'continue')
    refuseGet(
      'Finish the pending get before starting another operation.',
      envelope.data
    );
  if (gitEnvironmentOverrides.some((key) => process.env[key] !== undefined))
    refuseGet(
      'Continue get without Git repository/index overrides.',
      envelope.data
    );
  const data = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  validateGetRecovery(data);
  return true;
}

export function validateGetRecovery(
  data: TContinueConfig['data']
): GetOperation {
  const operation = data.get;
  if (!operation) refuseGet('No owned get intent.');
  const identity = getRecoveryIdentity();
  const repo = repoConfigFactory.load(undefined, { preserveInvalid: true });
  if (
    identity.root !== operation.root ||
    identity.commonDirectory !== operation.commonDirectory ||
    identity.gitDirectory !== operation.gitDirectory ||
    repo.data.trunk !== operation.trunk.branchName ||
    repo.getRemote() !== operation.remote ||
    `${repo.getRepoOwner()}/${repo.getRepoName()}` !== operation.repository ||
    gitPath('remote', 'get-url', operation.remote) !== operation.remoteUrl
  )
    refuseGet(
      'Continue get in its original worktree and configured repository.',
      operation
    );
  if (
    data.absorb ||
    data.delete ||
    data.move ||
    data.fold ||
    data.insert ||
    data.reorder ||
    data.split
  )
    refuseGet('Get intent overlaps another saved operation.', operation);
  const active = operation.active;
  const directory = getRebaseDirectory();
  if (
    !active ||
    !directory ||
    !ownsRebase(data.rebaseOwnership) ||
    operation.phase !== active.phase ||
    getRebaseHead() !== active.branchName ||
    data.rebasedBranchBase !== active.base ||
    fs.readFileSync(path.join(directory, 'onto'), 'utf8').trim() !==
      active.onto ||
    fs.readFileSync(path.join(directory, 'orig-head'), 'utf8').trim() !==
      active.originalHead
  )
    refuseGet(
      'No matching owned active get rebase; completed work may remain after abort or publication failure.',
      operation
    );
  if (!data.rebaseOwnership?.endsWith(`:${getRecoveryDigest(data)}`))
    refuseGet(
      'The saved get intent changed after its conflict was recorded.',
      operation
    );
  validateGetSources(operation);
  assertGetParticipantsAvailable(operation, active.branchName);
  return operation;
}

function sameGetMetadata(current: string, expected: string): boolean {
  if (current === expected) return true;
  if (!current || !expected) return false;
  const withoutFreeze = (oid: string): unknown => {
    const value = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(gitPath('cat-file', '-p', oid)));
    if (value.frozen !== undefined && typeof value.frozen !== 'boolean')
      throw new Error('Invalid frozen metadata.');
    delete value.frozen;
    return value;
  };
  try {
    return isDeepStrictEqual(withoutFreeze(current), withoutFreeze(expected));
  } catch {
    return false;
  }
}

function assertGetParticipantsAvailable(
  operation: GetOperation,
  activeBranch: string
): void {
  assertBranchEditable(activeBranch);
  for (const node of operation.nodes.filter(
    (item) => !operation.completedRemote.includes(item.branchName)
  ))
    if (node.resolution === 'REBASE') assertBranchEditable(node.branchName);
  for (const entry of operation.shouldRestack ? operation.maintenance : [])
    if (
      !entry.frozen &&
      !operation.completedMaintenance.includes(entry.branchName)
    )
      assertBranchEditable(entry.branchName);
  for (const expected of operation.expected)
    if (
      getSha(`refs/heads/${expected.branchName}`) !== expected.head ||
      !sameGetMetadata(
        getSha(`refs/branch-metadata/${expected.branchName}`),
        expected.metadata
      )
    )
      refuseGet(
        `${expected.branchName} changed outside the saved get plan.`,
        operation
      );
  const pending = operation.nodes.filter(
    (node) => !operation.completedRemote.includes(node.branchName)
  );
  const replay = operation.shouldRestack
    ? operation.maintenance.filter(
        (entry) =>
          !entry.frozen &&
          !operation.completedMaintenance.includes(entry.branchName)
      )
    : [];
  assertBranchesAvailableInWorktrees([
    ...pending
      .filter(
        (node) =>
          node.resolution ||
          node.previousHead !== node.head ||
          node.previousParentBranchName !== node.parentBranchName
      )
      .map((node) => node.branchName),
    ...replay.map((entry) => entry.branchName),
    ...(operation.checkout.shouldCheckout
      ? [operation.checkout.target]
      : 'branchName' in operation.checkout.original
      ? [operation.checkout.original.branchName]
      : []),
  ]);
  assertRestackFilesAvailable({
    branches: replay
      .filter(
        (entry) =>
          entry.branchName !== activeBranch &&
          getSha(`refs/heads/${entry.branchName}`)
      )
      .map((entry) => ({ name: entry.branchName, from: entry.base })),
    checkoutRevisions: [
      ...pending.map((node) => node.head),
      ...replay.flatMap((entry) => (entry.head ? [entry.head] : [])),
    ],
    skipTrackedPaths: true,
    operation: 'get',
  });
}

export function validateGetSources(operation: GetOperation): void {
  const sources = [operation.trunk, ...operation.nodes];
  if (
    new Set(sources.map((source) => source.sourceRef)).size !==
      sources.length ||
    new Set(operation.nodes.map((node) => node.branchName)).size !==
      operation.nodes.length
  )
    refuseGet('Duplicate get source identity.', operation);
  for (const source of sources)
    if (getSha(source.sourceRef) !== source.head)
      refuseGet(
        `Pinned get source ${source.sourceRef} is missing or changed.`,
        operation
      );
  for (const node of operation.nodes)
    if (
      node.head !== node.expectedSourceHead ||
      getSha(`${node.base}^{commit}`) !== node.base ||
      node.pullRequestUrl !==
        `https://github.com/${operation.repository}/pull/${node.pullRequestNumber}`
    )
      refuseGet(`Invalid saved source for ${node.branchName}.`, operation);
}

export function saveGetOperation(
  operation: GetOperation,
  context: TContext,
  branch?: string
): void {
  if (branch) {
    const state = {
      branchName: branch,
      head: getSha(`refs/heads/${branch}`),
      metadata: getSha(`refs/branch-metadata/${branch}`),
    };
    const previous = operation.expected.findIndex(
      (item) => item.branchName === branch
    );
    if (previous < 0) operation.expected.push(state);
    else operation.expected[previous] = state;
  }
  assertGetRecoveryWrite(context);
  context.continueConfig.update((data) => {
    data.get = operation;
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
  });
  recordGetRecoveryWrite(context);
}

export function recordGetConflict(
  data: TContinueConfig['data'],
  base: string
): void {
  const operation = data.get;
  if (
    !operation ||
    (operation.phase !== 'remote' && operation.phase !== 'maintenance')
  )
    return;
  const directory = getRebaseDirectory();
  const branchName = getRebaseHead();
  if (!directory || !branchName)
    refuseGet('Cannot identify the active get conflict.', operation);
  operation.active = {
    branchName,
    phase: operation.phase,
    base,
    onto: fs.readFileSync(path.join(directory, 'onto'), 'utf8').trim(),
    originalHead: fs
      .readFileSync(path.join(directory, 'orig-head'), 'utf8')
      .trim(),
  };
}

export function finishGetRecovery(
  operation: GetOperation,
  context: TContext
): void {
  assertGetRecoveryWrite(context);
  const fresh = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  if (JSON.stringify(fresh) !== JSON.stringify(context.continueConfig.data))
    refuseGet(
      'Saved get ownership differs from the completed workflow.',
      operation
    );
  validateGetSources(operation);
  for (const source of [operation.trunk, ...operation.nodes]) {
    assertGetRecoveryWrite(context);
    gitPath('update-ref', '-d', source.sourceRef, source.head);
  }
  assertGetRecoveryWrite(context);
  if (context.continueConfig.data.get !== operation)
    refuseGet('Get recovery owner changed.', operation);
  context.continueConfig.delete();
}

export function reportGetFailure(
  operation: GetOperation,
  error: unknown
): never {
  let live = false;
  try {
    live = Boolean(
      operation.active &&
        ownsRebase(
          continueConfigFactory.load(undefined, { preserveInvalid: true }).data
            .rebaseOwnership
        )
    );
  } catch {
    /* Preserve unreadable foreign recovery. */
  }
  const reachedTrunk = getSha(`refs/heads/${operation.trunk.branchName}`);
  const uncertain = operation.expected
    .filter(
      (item) =>
        getSha(`refs/heads/${item.branchName}`) !== item.head ||
        getSha(`refs/branch-metadata/${item.branchName}`) !== item.metadata
    )
    .map((item) => item.branchName);
  throw new ExitFailedError(
    `${
      reachedTrunk !== operation.trunk.previousHead
        ? `Trunk ${operation.trunk.branchName} reached ${reachedTrunk}.\n`
        : ''
    }Get stopped during ${operation.phase}. Updated ${
      operation.updated.join(', ') || 'none'
    }.\nCompleted feature refresh: ${
      operation.completedRemote.join(', ') || 'none'
    }.\nPending feature refresh: ${
      operation.nodes
        .filter((node) => !operation.completedRemote.includes(node.branchName))
        .map((node) => node.branchName)
        .join(', ') || 'none'
    }.\nCompleted local maintenance: ${
      operation.completedMaintenance.join(', ') || 'none'
    }.\nPending local maintenance: ${
      operation.maintenance
        .filter(
          (entry) => !operation.completedMaintenance.includes(entry.branchName)
        )
        .map((entry) => entry.branchName)
        .join(', ') || 'none'
    }.\nReached changes requiring inspection: ${
      uncertain.join(', ') || 'none'
    }.\nRetained get sources: ${[operation.trunk, ...operation.nodes]
      .map((source) => source.sourceRef)
      .join(', ')}.\nActual checkout: ${
      getCurrentBranchName() ?? 'detached HEAD'
    } (${getSha('HEAD')}).\nOriginal project: ${operation.root}. ${
      live
        ? 'Resolve the conflict and run an continue.'
        : 'No verified active rebase; inspect reached work and saved get intent manually.'
    }\n${error instanceof Error ? error.message : String(error)}`
  );
}
