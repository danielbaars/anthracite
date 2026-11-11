import { assertBranchEditable } from '../../lib/engine/frozen_branch';
import { sameMetadataExceptFrozen } from '../../lib/engine/metadata_comparison';
import {
  getMetadataRefList,
  readMetadataRef,
} from '../../lib/engine/metadata_ref';
import { getSha } from '../../lib/git/get_sha';
import { assertBranchesAvailableInWorktrees } from '../../lib/git/worktrees';
import { assertRestackFilesAvailable } from '../../lib/git/restack_files';
import { SyncOperation } from './sync_operation';
import { refuseSync } from './sync_recovery';

export function assertSyncSources(operation: SyncOperation): void {
  const sources = [
    ...(operation.refresh.trunk ? [operation.refresh.trunk] : []),
    ...operation.refresh.nodes,
  ];
  if (
    new Set(sources.map((source) => source.sourceRef)).size !==
      sources.length ||
    new Set(operation.refresh.nodes.map((node) => node.branchName)).size !==
      operation.refresh.nodes.length
  )
    refuseSync('Duplicate sync source identity.');
  for (const source of sources)
    if (getSha(source.sourceRef) !== source.head)
      refuseSync(
        `Pinned sync source ${source.sourceRef} is missing or changed.`
      );
  const preserved = operation.refresh.preserved ?? [];
  if (
    new Set(preserved).size !== preserved.length ||
    preserved.some((name) => {
      const node = operation.refresh.nodes.find(
        (candidate) => candidate.branchName === name
      );
      return (
        !node ||
        node.resolution !== undefined ||
        node.previousParentBranchName !== node.parentBranchName ||
        !node.previousBase
      );
    })
  )
    refuseSync('Invalid saved local-preservation decision.');
  for (const node of operation.refresh.nodes)
    if (
      node.head !== node.expectedSourceHead ||
      getSha(`${node.base}^{commit}`) !== node.base ||
      node.pullRequestUrl !==
        `https://github.com/${operation.repository}/pull/${node.pullRequestNumber}`
    )
      refuseSync(`Invalid saved sync source for ${node.branchName}.`);
}
export function assertSyncExpected(
  operation: SyncOperation,
  hookBranch?: string
): void {
  const untouched = new Set(
    operation.cleanup.untouched.map((entry) => entry.branchName)
  );
  for (const expected of operation.expected) {
    const metadata = getSha(`refs/branch-metadata/${expected.branchName}`);
    if (
      (expected.branchName !== hookBranch &&
        getSha(`refs/heads/${expected.branchName}`) !== expected.head) ||
      (untouched.has(expected.branchName)
        ? metadata !== expected.metadata
        : !sameMetadataExceptFrozen(metadata, expected.metadata))
    )
      refuseSync(
        `${expected.branchName} changed outside the saved sync plan; refusing before staging or advancing.`
      );
  }
  for (const name of Object.keys(getMetadataRefList()))
    if (!operation.expected.some((entry) => entry.branchName === name))
      refuseSync(`Unexpected tracked branch ${name} appeared during sync.`);
}
export function assertSyncParticipants(
  operation: SyncOperation,
  activeBranch: string,
  hookBranch?: string
): void {
  assertSyncExpected(operation, hookBranch);
  assertBranchEditable(activeBranch);
  const pending = operation.refresh.nodes.filter(
    (node) => !operation.completedRemote.includes(node.branchName)
  );
  for (const node of pending)
    if (node.resolution === 'REBASE') assertBranchEditable(node.branchName);
  const replay = operation.cleanup.restack
    ? operation.maintenance.filter(
        (entry) => !operation.completedMaintenance.includes(entry.branchName)
      )
    : [];
  for (const entry of replay) {
    if (entry.frozen) {
      if (readMetadataRef(entry.branchName).frozen !== true)
        refuseSync(
          `${entry.branchName} was planned as a frozen anchor and became editable.`
        );
    } else assertBranchEditable(entry.branchName);
  }
  for (const name of getPendingSyncMandatory(operation))
    assertBranchEditable(name);
  const cleanup = operation.cleanupCompleted
    ? []
    : [...operation.cleanup.accepted, ...operation.cleanup.mandatory];
  const original = operation.refresh.original;
  const final =
    'branchName' in original
      ? operation.cleanup.accepted.includes(original.branchName)
        ? operation.trunkName
        : original.branchName
      : undefined;
  assertBranchesAvailableInWorktrees([
    ...pending
      .filter(
        (node) =>
          node.resolution ||
          node.previousHead !== node.head ||
          node.previousParentBranchName !== node.parentBranchName
      )
      .map((node) => node.branchName),
    ...replay.filter((entry) => !entry.frozen).map((entry) => entry.branchName),
    ...cleanup,
    ...(final ? [final] : []),
  ]);
  assertRestackFilesAvailable({
    branches: replay
      .filter((entry) => !entry.frozen && entry.branchName !== activeBranch)
      .map((entry) => ({ name: entry.branchName, from: entry.base })),
    checkoutRevisions: [
      ...pending.map((node) => node.head),
      ...replay.flatMap((entry) => (entry.head ? [entry.head] : [])),
      ...(final
        ? [getSha(`refs/heads/${final}`)]
        : 'detachedOid' in original
        ? [original.detachedOid]
        : []),
    ].filter(Boolean),
    skipTrackedPaths: true,
    operation: 'get',
  });
}

/** Completed cleanup publications stay expected state, not future edit participants. */
export function getPendingSyncMandatory(operation: SyncOperation): string[] {
  const mandatory = operation.cleanupCompleted
    ? operation.cleanup.restack
      ? operation.cleanup.replay
      : []
    : operation.cleanup.mandatory;
  return mandatory.filter(
    (name) => !operation.completedMaintenance.includes(name)
  );
}
