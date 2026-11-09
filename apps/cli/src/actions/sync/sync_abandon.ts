import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { ExitFailedError } from '../../lib/errors';
import { readMetadataRef } from '../../lib/engine/metadata_ref';
import { getCacheLock } from '../../lib/engine/cache_lock';
import { getCurrentBranchName } from '../../lib/git/branch_ops';
import { getSha } from '../../lib/git/get_sha';
import { runGitCommand } from '../../lib/git/runner';
import { getRebaseDirectory } from '../../lib/git/rebase_in_progress';
import { landingProgressPath } from '../../lib/landing_progress';
import {
  quitSyncRebase,
  retainSyncAutostash,
  verifyRetainedSyncAutostash,
} from './sync_abandon_rebase';
import {
  assertRetainedSyncFile,
  retainSyncFile,
  syncDirectory,
} from './sync_abandon_archive';
import {
  assertOwnedSyncRebase,
  readOwnedSyncRecovery,
  refuseSync,
} from './sync_recovery';

export type OwnedSync = NonNullable<ReturnType<typeof readOwnedSyncRecovery>>;
const git = (...args: string[]): string =>
  runGitCommand({
    args,
    onError: 'throw',
    resource: 'syncAbort',
    options: { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  });

/** This route deliberately bypasses engine initialization and its recovery repairs. */
export function abandonSync(): void {
  const owned = readOwnedSyncRecovery();
  if (!owned) {
    process.stdout.write(
      'No pending sync to abandon; other recovery and Git state left untouched.\n'
    );
    return;
  }
  const lock = getCacheLock();
  let archive: string | undefined;
  let quit = 'not requested';
  try {
    lock.lock(Date.now());
    assertSavedSync(owned);
    const directory = assertAbandonmentGitState(owned);
    archive = archiveSync(owned);
    const autostash = directory
      ? retainSyncAutostash(owned, archive, directory)
      : undefined;
    assertSavedSync(owned);
    if (assertAbandonmentGitState(owned) !== directory)
      refuseSync('Active Git state changed before release.');
    if (directory) {
      retainSyncFile(
        path.join(archive, 'quit.json'),
        JSON.stringify({ version: 1, autostash: autostash ?? null }, null, 2) +
          '\n'
      );
      verifyRetainedSyncAutostash(owned, archive);
      quit = 'requested; result not confirmed';
      quitSyncRebase(owned, directory, autostash);
      quit = 'completed';
    }
    assertSavedSync(owned);
    if (getRebaseDirectory())
      refuseSync('Active Git rebase remains after quit.');
    assertAbandonmentGitState(owned);
    verifyRetainedSyncAutostash(owned, archive);
    releaseSync(owned, archive);
    reportAbandonment(owned, archive);
  } catch (error) {
    throw new ExitFailedError(
      `Sync abandonment incomplete${
        archive ? `; Archive: ${archive}` : ''
      }. Owned rebase quit: ${quit}; current Git rebase state: ${
        ['rebase-merge', 'rebase-apply'].some((name) =>
          fs.existsSync(path.join(owned.operation.gitDirectory, name))
        )
          ? 'present'
          : 'absent'
      }. Saved sync gate: ${
        fs.existsSync(owned.file)
          ? 'still present'
          : 'absent; inspect reached release'
      }. ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    lock.release();
  }
}

export function assertSavedSync(owned: OwnedSync): void {
  const fresh = readOwnedSyncRecovery();
  if (!fresh || fresh.bytes !== owned.bytes)
    refuseSync('Saved sync ownership changed; competing recovery preserved.');
}

export function assertAbandonmentGitState(
  owned: OwnedSync
): string | undefined {
  if (fs.existsSync(landingProgressPath()))
    refuseSync('Sync recovery overlaps pending landing recovery.');
  const foreign = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
    'BISECT_START',
  ].find((name) =>
    fs.existsSync(path.join(owned.operation.gitDirectory, name))
  );
  if (foreign) refuseSync(`Foreign active Git state ${foreign}.`);
  const directories = ['rebase-merge', 'rebase-apply'].filter((name) =>
    fs.existsSync(path.join(owned.operation.gitDirectory, name))
  );
  if (directories.length > 1) refuseSync('Multiple active Git rebase states.');
  if (getRebaseDirectory()) return assertOwnedSyncRebase(owned.data).directory;
  return undefined;
}

function privateDirectory(directory: string): void {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
    refuseSync(
      `Archive directory is not private regular storage: ${directory}.`
    );
}
export function archiveSync(owned: OwnedSync): string {
  const root = path.join(
    owned.operation.commonDirectory,
    'anthracite-sync-abandonment'
  );
  privateDirectory(root);
  const digest = createHash('sha256').update(owned.bytes).digest('hex');
  const archive = path.join(root, digest);
  privateDirectory(archive);
  retainSyncFile(path.join(archive, 'recovery.json'), owned.bytes);
  const sources = [
    ...(owned.operation.refresh.trunk ? [owned.operation.refresh.trunk] : []),
    ...owned.operation.refresh.nodes,
  ];
  const observations = path.join(archive, 'observations.json');
  if (!fs.existsSync(observations))
    retainSyncFile(
      observations,
      JSON.stringify(
        {
          version: 1,
          recoveryDigest: digest,
          pins: sources.map((source) => ({
            sourceRef: source.sourceRef,
            expectedHead: source.head,
            observedHead: getSha(source.sourceRef) || null,
          })),
          head: getSha('HEAD'),
          checkout: getCurrentBranchName() ?? null,
        },
        null,
        2
      ) + '\n'
    );
  else {
    const stat = fs.lstatSync(observations);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0)
      refuseSync(`Invalid retained source observations: ${observations}.`);
    const value = z
      .object({
        version: z.literal(1),
        recoveryDigest: z.literal(digest),
        pins: z.array(
          z
            .object({
              sourceRef: z.string(),
              expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/),
              observedHead: z
                .string()
                .regex(/^[a-f0-9]{40,64}$/)
                .nullable(),
            })
            .strict()
        ),
        head: z.string().regex(/^[a-f0-9]{40,64}$/),
        checkout: z.string().nullable(),
      })
      .strict()
      .safeParse(JSON.parse(fs.readFileSync(observations, 'utf8')));
    if (
      !value.success ||
      value.data.pins.length !== sources.length ||
      value.data.pins.some(
        (entry, index) =>
          entry.sourceRef !== sources[index].sourceRef ||
          entry.expectedHead !== sources[index].head
      )
    )
      refuseSync(`Conflicting source observations: ${observations}.`);
  }
  syncDirectory(archive);
  syncDirectory(root);
  syncDirectory(owned.operation.commonDirectory);
  return archive;
}

/** Rename captures the actual file; a replaced owner is restored without overwriting. */
export function releaseSync(owned: OwnedSync, archive: string): void {
  const released = path.join(archive, 'released.gtcontinue');
  if (fs.lstatSync(released, { throwIfNoEntry: false }))
    assertRetainedSyncFile(released, owned.bytes);
  assertSavedSync(owned);
  const captured = path.join(archive, `release-${randomUUID()}.gtcontinue`);
  fs.closeSync(fs.openSync(captured, 'wx', 0o600));
  fs.renameSync(owned.file, captured);
  try {
    if (!fs.readFileSync(captured).equals(Buffer.from(owned.bytes)))
      refuseSync(
        `Recovery changed during release; competing bytes retained at ${captured}.`
      );
    retainSyncFile(released, owned.bytes);
    syncDirectory(archive);
    syncDirectory(path.dirname(owned.file));
    if (fs.existsSync(owned.file))
      refuseSync(
        'Another recovery appeared during release; it remains untouched.'
      );
    fs.unlinkSync(captured);
    if (fs.existsSync(owned.file))
      refuseSync(
        'Recovery appeared after release; inspect the retained archive and competing gate.'
      );
  } catch (error) {
    // Keep the gate retryable, without replacing a concurrent actor's recovery.
    if (!fs.existsSync(owned.file) && fs.existsSync(captured)) {
      try {
        fs.linkSync(captured, owned.file);
      } catch {
        /* Captured bytes remain available if another actor wins the link. */
      }
    }
    throw error;
  }
}

export function reportAbandonment(owned: OwnedSync, archive: string): void {
  const operation = owned.operation;
  const names = (items: readonly string[]): string =>
    items.join(', ') || 'none';
  const sources = [
    ...(operation.refresh.trunk ? [operation.refresh.trunk] : []),
    ...operation.refresh.nodes,
  ];
  const uncertain = operation.expected
    .filter(
      (entry) =>
        getSha(`refs/heads/${entry.branchName}`) !== entry.head ||
        getSha(`refs/branch-metadata/${entry.branchName}`) !== entry.metadata
    )
    .map((entry) => entry.branchName);
  const conflicts = git('diff', '--name-only', '--diff-filter=U');
  process.stdout.write(
    [
      'Sync abandoned; completed effects remain applied. No rollback or pending work was performed.',
      `Archive: ${archive}`,
      `Recorded completed trunk update: ${
        operation.trunkCompleted ? 'yes' : 'no'
      }.`,
      `Recorded completed feature refresh: ${names(
        operation.completedRemote
      )}.`,
      `Recorded completed cleanup deletions: ${names(
        operation.progress.deleted
      )}.`,
      `Recorded completed maintenance: ${names(
        operation.completedMaintenance
      )}.`,
      `Recorded incomplete cleanup metadata: ${names(
        operation.progress.incomplete
      )}.`,
      `Pending feature refresh: ${names(
        operation.refresh.nodes
          .filter(
            (entry) => !operation.completedRemote.includes(entry.branchName)
          )
          .map((entry) => entry.branchName)
      )}.`,
      `Pending cleanup: ${
        operation.cleanupCompleted ? 'none' : names(operation.cleanup.accepted)
      }.`,
      `Pending maintenance: ${names(
        operation.maintenance
          .filter(
            (entry) =>
              !operation.completedMaintenance.includes(entry.branchName)
          )
          .map((entry) => entry.branchName)
      )}.`,
      `Current local observations differing from saved state (missing/changed): ${names(
        uncertain
      )}.`,
      `Observed local refs/parents: ${
        operation.expected
          .map(
            (entry) =>
              `${entry.branchName}: head ${
                getSha(`refs/heads/${entry.branchName}`) || 'missing'
              }, parent ${
                readMetadataRef(entry.branchName).parentBranchName ??
                'unavailable'
              }`
          )
          .join('; ') || 'none'
      }.`,
      `Source pins missing/changed: ${names(
        sources
          .filter((entry) => getSha(entry.sourceRef) !== entry.head)
          .map((entry) => entry.sourceRef)
      )}.`,
      `Actual checkout: ${getCurrentBranchName() ?? 'detached HEAD'} (${getSha(
        'HEAD'
      )}).`,
      `Remaining index conflicts: ${conflicts || 'none'}.`,
      ...(fs.existsSync(path.join(archive, 'autostash.json'))
        ? [
            `Owned autostash retained without applying/discarding it; see ${path.join(
              archive,
              'autostash.json'
            )} and the retained private pin.`,
          ]
        : []),
      'Recorded completion is not fresh verification or GitHub readiness. PR status is not queried.',
      'Inspect git status and the retained archive. Deliberately handle residual Git/files before guarded deletion or a new sync; ending sync does not resolve conflicts or restore checkout.',
      '',
    ].join('\n')
  );
}
