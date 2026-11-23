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
    dependents: z.array(z.string().min(1)).optional(),
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

function reconciliationTips(
  entries: readonly SyncReconciliation[]
): Set<string> {
  return new Set(
    entries.flatMap(({ head, base, formerParentHead, publishedHead }) => [
      head,
      base,
      formerParentHead,
      publishedHead,
    ])
  );
}

export function assertSyncReconciliationPins(entry: SyncReconciliation): void {
  for (const tip of reconciliationTips([entry]))
    if (getSha(`${namespace}/commits/${tip}`) !== tip)
      throw new ExitFailedError(
        `A pinned sync reconciliation source for ${entry.branch} is missing or changed.`
      );
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
  const retained = before.entries.map((existing) => {
    const updated = entries.find((entry) => entry.branch === existing.branch);
    if (!updated) return existing;
    const dependents = new Set([
      ...(existing.dependents ?? []),
      ...(updated.dependents ?? []),
    ]);
    if (
      updated.publishedHead === existing.publishedHead &&
      dependents.size === (existing.dependents?.length ?? 0)
    )
      return existing;
    return {
      ...existing,
      publishedHead: updated.publishedHead,
      ...(dependents.size ? { dependents: [...dependents] } : {}),
    };
  });
  if (
    !additions.length &&
    retained.every((entry, index) => entry === before.entries[index])
  )
    return;
  const expected = new Map<string, string>();
  const changedSources = retained.filter(
    (entry, index) =>
      entry.publishedHead !== before.entries[index]?.publishedHead
  );
  for (const entry of [...additions, ...changedSources]) {
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
          entries: [...retained, ...additions],
        })
      ),
    },
    onError: 'throw',
    resource: 'storeSyncReconciliation',
  });
  const changed = [...additions, ...changedSources];
  const tips = [...reconciliationTips(changed)];
  const needed = reconciliationTips([...retained, ...additions]);
  const retired = [...reconciliationTips(before.entries)].filter(
    (tip) => !needed.has(tip)
  );
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
    ...retired.map((tip) => `delete ${namespace}/commits/${tip} ${tip}`),
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

type StackEdge = { branchName: string; parentBranchName: string };

function indexChildren(
  edges: readonly StackEdge[]
): ReadonlyMap<string, Set<string>> {
  const children = new Map<string, Set<string>>();
  for (const { branchName, parentBranchName } of edges) {
    const siblings = children.get(parentBranchName) ?? new Set<string>();
    siblings.add(branchName);
    children.set(parentBranchName, siblings);
  }
  return children;
}

function addLocalDescendants(
  names: Set<string>,
  children: ReadonlyMap<string, Set<string>>,
  startingAt: readonly string[]
): void {
  const pending = new Set(startingAt);
  for (const branch of pending) {
    names.add(branch);
    for (const child of children.get(branch) ?? [])
      if (!names.has(child)) pending.add(child);
  }
}

/** Retain branches connected only by a proposed PR base; local edges stay live. */
export function extendSyncReconciliation(
  entries: readonly SyncReconciliation[],
  edges: { local: readonly StackEdge[]; incoming: readonly StackEdge[] }
): readonly SyncReconciliation[] {
  const local = indexChildren(edges.local);
  const incoming = indexChildren(edges.incoming);
  return entries.map((entry) => {
    const dependents = new Set(entry.dependents);
    const names = new Set<string>();
    addLocalDescendants(names, local, [
      entry.branch,
      entry.formerParent,
      ...dependents,
    ]);
    for (const name of names) {
      for (const child of incoming.get(name) ?? []) {
        if (names.has(child)) continue;
        dependents.add(child);
        addLocalDescendants(names, local, [child]);
      }
    }
    return dependents.size > (entry.dependents?.length ?? 0)
      ? { ...entry, dependents: [...dependents].sort() }
      : entry;
  });
}

/** Retire the recovery record only with the verified replacement refs. */
export function finishSyncReconciliation(
  expected: Pick<SyncReconciliation, 'branch' | 'head' | 'base' | 'metadata'>,
  result: {
    readonly head: string;
    readonly metadata: string;
    readonly trunk: string;
    readonly onto: string;
  }
): void {
  const before = readSyncReconciliation();
  const entry = before.entries.find(({ branch }) => branch === expected.branch);
  if (
    !entry ||
    entry.head !== expected.head ||
    entry.base !== expected.base ||
    entry.metadata !== expected.metadata
  )
    throw new ExitFailedError(
      'Saved sync reconciliation changed before completion.'
    );
  const remaining = before.entries.filter(
    ({ branch }) => branch !== entry.branch
  );
  const metadata = remaining.length
    ? runGitCommand({
        args: ['hash-object', '-w', '--stdin'],
        options: { input: JSON.stringify({ version: 1, entries: remaining }) },
        onError: 'throw',
        resource: 'storeSyncReconciliation',
      })
    : '';
  const neededPins = reconciliationTips(remaining);
  const retired = [...reconciliationTips([entry])]
    .filter((tip) => !neededPins.has(tip))
    .map((tip) => `delete ${namespace}/commits/${tip} ${tip}`);
  runGitCommand({
    args: ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin'],
    options: {
      input: [
        'start',
        metadata
          ? `update ${stateRef} ${metadata} ${before.revision}`
          : `delete ${stateRef} ${before.revision}`,
        `verify refs/heads/${entry.branch} ${result.head}`,
        `verify refs/heads/${result.trunk} ${result.onto}`,
        `verify refs/branch-metadata/${entry.branch} ${result.metadata}`,
        ...retired,
        'prepare',
        'commit',
        '',
      ].join('\n'),
    },
    onError: 'throw',
    resource: 'finishSyncReconciliation',
  });
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
    const branchName = name;
    if (
      entries.some(
        (entry) =>
          entry.branch === name ||
          entry.formerParent === name ||
          entry.dependents?.includes(branchName)
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
