import { z } from 'zod';
import { ExitFailedError } from '../errors';
import { getSha } from '../git/get_sha';
import { runGitCommand } from '../git/runner';
import { readMetadataRef } from './metadata_ref';

const namespace = 'refs/gt-metadata/sync-reconciliation';
const stateRef = `${namespace}/state`;
const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const recordSchema = z
  .object({
    branch: z.string().min(1),
    head: oid,
    base: oid,
    metadata: oid,
    formerParent: z.string().min(1),
    formerParentHead: oid,
    mergedHead: oid,
    formerParentPr: z.number().int().positive(),
    pullRequest: z.number().int().positive(),
    pullRequestBase: z.string().min(1),
    publishedHead: oid,
  })
  .strict();
const stateSchema = z
  .object({ version: z.literal(1), entries: z.array(recordSchema) })
  .strict();
export type SyncReconciliation = z.infer<typeof recordSchema>;
export type ReconciliationState = {
  readonly revision: string;
  readonly entries: readonly SyncReconciliation[];
};

export function readSyncReconciliation(): ReconciliationState {
  const revision = getSha(stateRef);
  if (!revision) return { revision, entries: [] };
  const raw = runGitCommand({
    args: ['cat-file', 'blob', revision],
    onError: 'throw',
    resource: 'readSyncReconciliation',
  });
  try {
    const parsed = stateSchema.parse(JSON.parse(raw));
    return { revision, entries: parsed.entries };
  } catch {
    throw new ExitFailedError(
      'Saved sync reconciliation could not be read. Inspect the saved state before changing the affected branches.'
    );
  }
}

/** Publish the decision and its recoverable commit range in one ref transaction. */
export function retainSyncReconciliation(
  before: ReconciliationState,
  entries: readonly SyncReconciliation[]
): void {
  const additions = entries.filter(
    (entry) =>
      !before.entries.some((existing) => existing.branch === entry.branch)
  );
  if (!additions.length) return;
  const expected = new Map<string, string>();
  for (const entry of additions) {
    for (const [ref, revision] of captureDeferralRefs(entry)) {
      if (expected.has(ref) && expected.get(ref) !== revision)
        throw new ExitFailedError(
          'Sync reconciliation inputs disagree. Retry sync.'
        );
      expected.set(ref, revision);
    }
  }
  const metadata = runGitCommand({
    args: ['hash-object', '-w', '--stdin'],
    options: {
      input: JSON.stringify(
        stateSchema.parse({
          version: 1,
          entries: [...before.entries, ...additions],
        })
      ),
    },
    onError: 'throw',
    resource: 'storeSyncReconciliation',
  });
  const tips = [
    ...new Set(
      additions.flatMap(({ head, base, formerParentHead }) => [
        head,
        base,
        formerParentHead,
      ])
    ),
  ];
  const updates = [
    before.revision
      ? `update ${stateRef} ${metadata} ${before.revision}`
      : `create ${stateRef} ${metadata}`,
    ...[...expected].map(([ref, revision]) => `verify ${ref} ${revision}`),
    ...tips.map((tip) => {
      const ref = `${namespace}/commits/${tip}`;
      const existing = getSha(ref);
      return existing ? `verify ${ref} ${tip}` : `create ${ref} ${tip}`;
    }),
  ];
  runGitCommand({
    args: ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin'],
    options: {
      input: ['start', ...updates, 'prepare', 'commit', ''].join('\n'),
    },
    onError: 'throw',
    resource: 'retainSyncReconciliation',
  });
}

function captureDeferralRefs(entry: SyncReconciliation): [string, string][] {
  const metaRef = `refs/branch-metadata/${entry.branch}`;
  const revision = getSha(metaRef);
  const metadata = readMetadataRef(entry.branch);
  if (
    revision !== entry.metadata ||
    metadata.parentBranchName !== entry.formerParent ||
    metadata.parentBranchRevision !== entry.base
  )
    throw new ExitFailedError(
      `${entry.branch} changed while planning sync reconciliation. Retry sync.`
    );
  return [
    [metaRef, revision],
    [`refs/heads/${entry.branch}`, entry.head],
    [`refs/heads/${entry.formerParent}`, entry.formerParentHead],
  ];
}

/** Follow tracked parent edges so a dependent child cannot publish past a deferral. */
export function isPendingSyncReconciliation(
  branch: string,
  entries: readonly SyncReconciliation[]
): boolean {
  if (!entries.length) return false;
  const seen = new Set<string>();
  let name: string | undefined = branch;
  while (name && !seen.has(name)) {
    if (
      entries.some(
        (entry) => entry.branch === name || entry.formerParent === name
      )
    )
      return true;
    seen.add(name);
    name = readMetadataRef(name).parentBranchName;
  }
  return false;
}

export function assertBranchNotPendingReconciliation(branch: string): void {
  if (isPendingSyncReconciliation(branch, readSyncReconciliation().entries))
    throw new ExitFailedError(
      `Cannot modify ${branch} while it has pending reconciliation. Inspect the affected branches with an log.`
    );
}
