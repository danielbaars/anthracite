import fs from 'fs';
import path from 'path';
import { readMetadataRef } from '../lib/engine/metadata_ref';
import { assertBranchEditable } from '../lib/engine/frozen_branch';
import { PreconditionsFailedError } from '../lib/errors';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { runGitCommand } from '../lib/git/runner';
import { repoConfigFactory } from '../lib/spiffy/repo_config_spf';
import { continueConfigFactory } from '../lib/spiffy/continuation_spf';
import {
  FileSplitEntry,
  getFileSplitEntries,
  readFileSplitPathRecords,
} from './split_file_entries';

export type FileSplitParticipant = {
  readonly name: string;
  readonly from: string;
  readonly revision: string;
};
export type FileSplitPlan = {
  readonly source: string;
  readonly parent: string;
  readonly sourceRevision: string;
  readonly parentRevision: string;
  readonly generatedName: string;
  readonly selectedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly selectedEntries: readonly FileSplitEntry[];
  readonly descendants: readonly FileSplitParticipant[];
};

/** Read-only discovery must precede normal engine repair and recovery cleanup. */
export function planFileSplit(selectors: readonly string[]): FileSplitPlan {
  const override = [
    'GIT_INDEX_FILE',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
  ].find((name) => process.env[name] !== undefined);
  if (override)
    throw new PreconditionsFailedError(
      `Cannot split by file with ${override} set. Clear the repository/index override and retry explicitly.`
    );
  if (
    selectors.length === 0 ||
    selectors.some((value) => !value.trim() || value.includes('\0'))
  )
    throw new PreconditionsFailedError(
      'File split requires nonempty pathspec values.'
    );
  assertNoGitOperation('split by file');
  const continuation = path.resolve(
    readGit(['rev-parse', '--git-common-dir']),
    '.gtcontinue'
  );
  if (hasFileSplitRecovery(continuation))
    throw new PreconditionsFailedError(
      'Cannot split by file with existing continuation. Finish or inspect recovery first.'
    );
  const source = readGit(['branch', '--show-current'], true);
  if (!source)
    throw new PreconditionsFailedError('Cannot split a detached HEAD.');
  const config = repoConfigFactory.load(undefined, { preserveInvalid: true });
  if (!config.graphiteInitialized())
    throw new PreconditionsFailedError(
      'File split requires an initialized repository. Run an init explicitly.'
    );
  if (source === config.data.trunk)
    throw new PreconditionsFailedError('Cannot split trunk.');
  const meta = readMetadataRef(source);
  const parent = meta.parentBranchName;
  if (!parent || !meta.parentBranchRevision)
    throw new PreconditionsFailedError(
      'File split requires a valid tracked source. Track it explicitly first.'
    );
  const sourceRevision = readGit([
    'rev-parse',
    '--verify',
    `refs/heads/${source}`,
  ]);
  const parentRevision = readGit([
    'rev-parse',
    '--verify',
    `refs/heads/${parent}`,
  ]);
  if (meta.parentBranchRevision !== parentRevision)
    throw new PreconditionsFailedError(
      'Source needs restack. Run an restack before splitting.'
    );
  assertLinearSegment({
    name: source,
    from: parentRevision,
    revision: sourceRevision,
  });
  const changedPaths = changedEntries(parentRevision, sourceRevision, []);
  const selectedPaths = changedEntries(
    parentRevision,
    sourceRevision,
    selectors
  );
  if (selectedPaths.length === 0)
    throw new PreconditionsFailedError(
      'No net changed files match the selection. Choose a committed changed path.'
    );
  if (selectedPaths.length === changedPaths.length)
    throw new PreconditionsFailedError(
      'File split would leave no remainder. Choose a proper subset of changed files.'
    );
  const selectedEntries = getFileSplitEntries({
    parentRevision,
    sourceRevision,
    changedPaths,
    selectedPaths,
  });
  if (readGit(['status', '--porcelain=v1', '-z', '--untracked-files=no']))
    throw new PreconditionsFailedError(
      'There are tracked changes that have not been committed. Resolve them before splitting.'
    );
  const descendants = planDescendants(source);
  const participants = [source, ...descendants.map(({ name }) => name)];
  participants.forEach(assertBranchEditable);
  assertBranchesAvailableInWorktrees(participants);
  assertRestackFilesAvailable({
    branches: descendants,
    checkoutRevisions: [
      sourceRevision,
      ...descendants.map(({ revision }) => revision),
    ],
    skipTrackedPaths: true,
    operation: 'split',
  });
  return {
    source,
    parent,
    sourceRevision,
    parentRevision,
    selectedPaths,
    changedPaths,
    selectedEntries,
    descendants,
    generatedName: allocateName(source),
  };
}

/** Successful older operations can leave only their two empty legacy queues. */
function hasFileSplitRecovery(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const data = continueConfigFactory.load(file, {
      preserveInvalid: true,
    }).data;
    return !(
      data.branchesToSync.length === 0 &&
      data.branchesToRestack.length === 0 &&
      Object.keys(data).every((key) =>
        ['branchesToSync', 'branchesToRestack'].includes(key)
      )
    );
  } catch {
    return true;
  }
}

function planDescendants(source: string): FileSplitParticipant[] {
  const heads = readGit([
    'for-each-ref',
    '--format=%(refname:lstrip=2)',
    'refs/heads/',
  ])
    .split('\n')
    .filter(Boolean);
  const metadata = new Map(heads.map((name) => [name, readMetadataRef(name)]));
  const queue: FileSplitParticipant[] = [];
  const visited = new Set([source]);
  const visit = (parent: string): void => {
    for (const name of heads
      .filter((head) => metadata.get(head)?.parentBranchName === parent)
      .sort()) {
      if (visited.has(name))
        throw new PreconditionsFailedError('Invalid cyclic split descendants.');
      visited.add(name);
      const from = metadata.get(name)?.parentBranchRevision;
      if (!from)
        throw new PreconditionsFailedError(
          `Invalid tracked descendant ${name}.`
        );
      const participant = {
        name,
        from,
        revision: readGit(['rev-parse', '--verify', `refs/heads/${name}`]),
      };
      assertLinearSegment(participant);
      queue.push(participant);
      visit(name);
    }
  };
  visit(source);
  return queue;
}

function assertLinearSegment({
  name,
  from,
  revision,
}: FileSplitParticipant): void {
  if (readGit(['merge-base', from, revision], true) !== from)
    throw new PreconditionsFailedError(`Invalid recorded base for ${name}.`);
  if (readGit(['rev-list', '--merges', `${from}..${revision}`]))
    throw new PreconditionsFailedError(
      `Cannot split unsupported merge history in ${name}.`
    );
}

function changedEntries(
  from: string,
  to: string,
  selectors: readonly string[]
): string[] {
  return readFileSplitPathRecords([
    'diff',
    '--no-relative',
    '--no-ext-diff',
    '--no-textconv',
    '--ignore-submodules=none',
    '--name-only',
    '--no-renames',
    '-z',
    from,
    to,
    '--',
    ...selectors,
  ])
    .split('\0')
    .filter(Boolean);
}

function allocateName(source: string): string {
  const heads = readGit([
    'for-each-ref',
    '--format=%(refname:lstrip=2)',
    'refs/heads/',
    'refs/branch-metadata/',
  ]).split('\n');
  let name = `${source}_split`;
  while (
    heads.some(
      (head) =>
        head === name ||
        head.startsWith(`${name}/`) ||
        name.startsWith(`${head}/`)
    )
  )
    name += '_split';
  readGit(['check-ref-format', '--branch', name]);
  return name;
}

function readGit(args: string[], ignoreError = false): string {
  return runGitCommand({
    args,
    options: { noTrim: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    onError: ignoreError ? 'ignore' : 'throw',
    resource: 'fileSplitPreflight',
  }).replace(/\n$/, '');
}
