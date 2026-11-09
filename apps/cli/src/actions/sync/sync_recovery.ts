import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { getRebaseDirectory } from '../../lib/git/rebase_in_progress';
import { getRebaseHead } from '../../lib/git/merge_conflict_help';
import { ownsRebase } from '../../lib/git/rebase_ownership';
import { gitEnvironmentOverrides } from '../../lib/git/environment_overrides';
import { getSyncRemoteUrl, getSyncRepository } from './sync_identity';
import { getSha } from '../../lib/git/get_sha';
import {
  continueConfigFactory,
  TContinueConfig,
} from '../../lib/spiffy/continuation_spf';
import { repoConfigFactory } from '../../lib/spiffy/repo_config_spf';
import {
  getRecoveryFile,
  getRecoveryIdentity,
  getRecoveryDigest,
} from './get_recovery';
import { SyncOperation, syncOperationSchema } from './sync_operation';
import {
  assertSyncParticipants,
  assertSyncSources,
  assertSyncExpected,
} from './sync_recovery_guards';

const records = new WeakMap<TContinueConfig, string>();
// Carry verified writer bytes across hooks instead of adopting a fresh disk owner.
let syncHookOwnership: string | undefined;
export function getSyncHookOwnership(): string | undefined {
  return syncHookOwnership;
}

export function assertSyncHookOwnership(expected?: string): void {
  if (!expected) return;
  const file = getRecoveryFile();
  if (
    !fs.existsSync(file) ||
    createHash('sha256').update(fs.readFileSync(file)).digest('hex') !==
      expected
  )
    refuseSync(
      'Saved sync ownership changed during a Git hook; inspect foreign recovery.'
    );
}

export function refuseSync(reason: string): never {
  throw new ExitFailedError(
    `${reason} Sync recovery preserved. Inspect git status, git log, source refs and saved .gtcontinue in the original project. Raw git rebase --abort cancels only its active rebase, not reached updates. No unverified queue or automatic rollback is permitted. To end a supported owned sync preserving reached work and residual files, use an sync --abort; foreign or malformed state still requires inspection.`
  );
}
export function assertSyncRecoveryWrite(context: TContext): void {
  const previous = records.get(context.continueConfig);
  const file = context.continueConfig.path;
  if (
    previous === undefined
      ? fs.existsSync(file)
      : !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== previous
  )
    refuseSync(
      'Saved sync ownership changed on disk; inspect foreign recovery.'
    );
}
export function recordSyncRecoveryWrite(context: TContext): void {
  if (!context.continueConfig.data.sync) return;
  const saved = fs.readFileSync(context.continueConfig.path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    refuseSync(
      'Saved sync record became malformed before ownership recording.'
    );
  }
  if (JSON.stringify(value) !== JSON.stringify(context.continueConfig.data))
    refuseSync(
      'Saved sync owner differs from the current workflow; inspect foreign recovery.'
    );
  records.set(context.continueConfig, saved);
  syncHookOwnership = createHash('sha256').update(saved).digest('hex');
}

/** Dispatch before context repair, legacy queue handling or incidental staging. */
export function preflightSyncRecovery(command: string): boolean {
  const file = getRecoveryFile();
  if (!fs.existsSync(file)) return false;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    refuseSync('Malformed continuation JSON.');
  }
  if (typeof value !== 'object' || value === null || !('sync' in value))
    return false;
  const result = syncOperationSchema.safeParse(value.sync);
  if (!result.success) refuseSync('Incompatible or malformed sync intent.');
  const allowed = new Set([
    'sync',
    'branchesToSync',
    'branchesToRestack',
    'currentBranchOverride',
    'rebasedBranchBase',
    'rebaseOwnership',
    'delete',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    refuseSync('Sync intent overlaps foreign recovery fields.');
  if (command !== 'continue')
    refuseSync('Finish the pending sync before starting another operation.');
  if (gitEnvironmentOverrides.some((key) => process.env[key] !== undefined))
    refuseSync('Continue sync without Git repository/index overrides.');
  validateSyncRecovery(
    continueConfigFactory.load(undefined, { preserveInvalid: true }).data
  );
  return true;
}

/** Read supported intent without granting continuation or participant rewrite authority. */
export function readOwnedSyncRecovery():
  | {
      readonly data: TContinueConfig['data'];
      readonly operation: SyncOperation;
      readonly bytes: string;
      readonly file: string;
    }
  | undefined {
  const file = getRecoveryFile();
  if (!fs.existsSync(file)) return undefined;
  if (!fs.lstatSync(file).isFile())
    refuseSync('Saved recovery is not a regular file.');
  const original = fs.readFileSync(file);
  const bytes = original.toString('utf8');
  if (!Buffer.from(bytes).equals(original))
    refuseSync(
      'Saved sync recovery is not valid UTF-8; original bytes preserved.'
    );
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    refuseSync('Malformed continuation JSON.');
  }
  if (typeof value !== 'object' || value === null || !('sync' in value))
    return undefined;
  if (gitEnvironmentOverrides.some((key) => process.env[key] !== undefined))
    refuseSync('Inspect owned sync without Git repository/index overrides.');
  const parsed = syncOperationSchema.safeParse(value.sync);
  if (!parsed.success) refuseSync('Incompatible or malformed sync intent.');
  const allowed = new Set([
    'sync',
    'branchesToSync',
    'branchesToRestack',
    'currentBranchOverride',
    'rebasedBranchBase',
    'rebaseOwnership',
    'delete',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    refuseSync('Sync intent overlaps foreign recovery fields.');
  const data = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  if (fs.readFileSync(file, 'utf8') !== bytes)
    refuseSync('Saved sync ownership changed while reading.');
  const operation = parsed.data;
  if (
    (parsed.data.active || data.rebaseOwnership !== undefined) &&
    (!data.rebaseOwnership?.match(/^[a-f0-9-]{36}:[a-f0-9]{64}$/) ||
      !data.rebaseOwnership.endsWith(`:${getRecoveryDigest(data)}`))
  )
    refuseSync(
      'The saved sync intent changed after its conflict was recorded.'
    );
  if (
    data.delete &&
    (!operation.cleanupCompleted ||
      !operation.cleanup.restack ||
      data.delete.branch !== 'Cleanup candidates' ||
      JSON.stringify(data.delete.mandatory) !==
        JSON.stringify(
          operation.cleanup.replay.filter(
            (name) => !operation.completedMaintenance.includes(name)
          )
        ))
  )
    refuseSync('Sync intent overlaps foreign cleanup recovery.');
  if (
    !operation.active &&
    !data.rebaseOwnership &&
    (data.branchesToSync.length ||
      data.branchesToRestack.length ||
      data.rebasedBranchBase !== undefined)
  )
    refuseSync('Sync intent overlaps an unverified legacy queue.');
  const identity = getRecoveryIdentity();
  const repo = repoConfigFactory.load(undefined, { preserveInvalid: true });
  if (
    identity.root !== operation.root ||
    identity.commonDirectory !== operation.commonDirectory ||
    identity.gitDirectory !== operation.gitDirectory ||
    repo.data.trunk !== operation.trunkName ||
    repo.getRemote() !== operation.remote ||
    getSyncRepository(repo) !== operation.repository ||
    getSyncRemoteUrl(operation.remote) !== operation.remoteUrl
  )
    refuseSync(
      'Inspect owned sync in its original worktree and configured repository.'
    );
  return { data, operation, bytes, file };
}

export function validateSyncRecovery(
  data: TContinueConfig['data'],
  protections = true
): SyncOperation {
  const operation = data.sync;
  if (!operation) refuseSync('No owned sync intent.');
  const identity = getRecoveryIdentity();
  const repo = repoConfigFactory.load(undefined, { preserveInvalid: true });
  if (
    identity.root !== operation.root ||
    identity.commonDirectory !== operation.commonDirectory ||
    identity.gitDirectory !== operation.gitDirectory ||
    repo.data.trunk !== operation.trunkName ||
    repo.getRemote() !== operation.remote ||
    getSyncRepository(repo) !== operation.repository ||
    getSyncRemoteUrl(operation.remote) !== operation.remoteUrl
  )
    refuseSync(
      'Continue sync in its original worktree and configured repository.'
    );
  const { active } = assertOwnedSyncRebase(data);
  assertSyncSources(operation);
  if (protections) assertSyncParticipants(operation, active.branchName);
  else assertSyncExpected(operation);
  return operation;
}

/** Rebase identity is separate from mutable branch/source continuation protections. */
export function assertOwnedSyncRebase(data: TContinueConfig['data']): {
  readonly directory: string;
  readonly active: NonNullable<SyncOperation['active']>;
} {
  const operation = data.sync;
  if (!operation) refuseSync('No owned sync intent.');
  const active = operation.active;
  const directory = getRebaseDirectory();
  if (
    directory &&
    (!fs.lstatSync(directory).isDirectory() ||
      ['head-name', 'onto', 'orig-head', 'charcoal-continuation'].some(
        (name) =>
          !fs.existsSync(path.join(directory, name)) ||
          !fs.lstatSync(path.join(directory, name)).isFile()
      ))
  )
    refuseSync('Owned rebase markers are not regular local files.');
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
    refuseSync(
      'No matching owned active sync rebase; completed work may remain after abort or publication failure.'
    );
  if (!data.rebaseOwnership?.endsWith(`:${getRecoveryDigest(data)}`))
    refuseSync(
      'The saved sync intent changed after its conflict was recorded.'
    );
  return { directory: fs.realpathSync(directory), active };
}

export function saveSyncOperation(
  operation: SyncOperation,
  context: TContext,
  branch?: string
): void {
  if (branch) {
    const expected = operation.expected.find(
      (entry) => entry.branchName === branch
    );
    if (!expected) refuseSync(`Unexpected sync participant ${branch}.`);
    expected.head = getSha(`refs/heads/${branch}`);
    expected.metadata = getSha(`refs/branch-metadata/${branch}`);
  }
  assertSyncRecoveryWrite(context);
  context.continueConfig.update((data) => {
    data.sync = operation;
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
    if (
      operation.cleanupCompleted &&
      operation.cleanup.restack &&
      operation.cleanup.replay.length
    )
      data.delete = {
        branch: 'Cleanup candidates',
        mandatory: operation.cleanup.replay.filter(
          (name) => !operation.completedMaintenance.includes(name)
        ),
      };
  });
  recordSyncRecoveryWrite(context);
}
export function recordSyncConflict(
  data: TContinueConfig['data'],
  base: string
): void {
  const operation = data.sync;
  if (
    !operation ||
    (operation.phase !== 'remote' && operation.phase !== 'maintenance')
  )
    return;
  const directory = getRebaseDirectory();
  const branchName = getRebaseHead();
  if (!directory || !branchName)
    refuseSync('Cannot identify the active sync conflict.');
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

export function assertSyncHookParticipants(branch: string): void {
  const file = getRecoveryFile();
  if (!fs.existsSync(file)) return;
  const data = continueConfigFactory.load(undefined, {
    preserveInvalid: true,
  }).data;
  const operation = data.sync;
  if (!operation) return;
  if (operation.active && !getRebaseDirectory()) return;
  if (
    operation.active &&
    (!ownsRebase(data.rebaseOwnership) ||
      !data.rebaseOwnership?.endsWith(`:${getRecoveryDigest(data)}`))
  )
    refuseSync('Owned sync intent changed during a Git hook.');
  assertSyncSources(operation);
  assertSyncParticipants(operation, branch, branch);
}
