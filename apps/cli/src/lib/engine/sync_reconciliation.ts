import { z } from 'zod';
import { ExitFailedError } from '../errors';
import { getSha } from '../git/get_sha';
import { runGitCommand } from '../git/runner';
import { readMetadataRef } from './metadata_ref';

const namespace = 'refs/gt-metadata/sync-reconciliation';
const stateRef = `${namespace}/state`;
const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
/** Literal components of refs/heads, without Git's shorthand expansion. */
export const reconciliationBranchName = z
  .string()
  .min(1)
  .refine(
    (name) =>
      name !== '@' &&
      !name.startsWith('-') &&
      !name.endsWith('.') &&
      !name.includes('..') &&
      !name.includes('@{') &&
      !/[ ~^:?*[\\]/u.test(name) &&
      ![...name].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) &&
      name
        .split('/')
        .every(
          (component) =>
            component &&
            !component.startsWith('.') &&
            !component.endsWith('.lock')
        )
  );

const recordSchema = z
  .object({
    branch: reconciliationBranchName,
    head: oid,
    base: oid,
    metadata: oid,
    formerParent: reconciliationBranchName,
    formerParentHead: oid,
    mergedHead: oid,
    formerParentPr: z.number().int().positive(),
    pullRequest: z.number().int().positive(),
    pullRequestBase: reconciliationBranchName,
    publishedHead: oid,
    dependents: z.array(reconciliationBranchName).optional(),
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

function reconciliationPins(
  entries: readonly SyncReconciliation[]
): Map<string, string> {
  const pins = new Map<string, string>();
  for (const {
    head,
    base,
    formerParentHead,
    publishedHead,
    metadata,
  } of entries) {
    for (const tip of [head, base, formerParentHead, publishedHead])
      pins.set(`${namespace}/commits/${tip}`, tip);
    pins.set(`${namespace}/metadata/${metadata}`, metadata);
  }
  return pins;
}

export function assertSyncReconciliationPins(entry: SyncReconciliation): void {
  for (const [ref, revision] of reconciliationPins([entry]))
    if (getSha(ref) !== revision)
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
    const dependents = updated.dependents ?? [];
    if (
      updated.publishedHead === existing.publishedHead &&
      updated.metadata === existing.metadata &&
      dependents.length === (existing.dependents?.length ?? 0) &&
      dependents.every((name) => existing.dependents?.includes(name))
    )
      return existing;
    return {
      ...existing,
      publishedHead: updated.publishedHead,
      metadata: updated.metadata,
      dependents: dependents.length ? dependents : undefined,
    };
  });
  if (
    !additions.length &&
    retained.every((entry, index) => entry === before.entries[index])
  )
    return;
  const expected = new Map<string, string>();
  const changedSources = retained.filter(
    (entry, index) => entry !== before.entries[index]
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
  const changed = reconciliationPins([...additions, ...changedSources]);
  const needed = reconciliationPins([...retained, ...additions]);
  const retired = [...reconciliationPins(before.entries)].filter(
    ([ref]) => !needed.has(ref)
  );
  const updates = [
    before.revision
      ? `update ${stateRef}\0${metadata}\0${before.revision}\0`
      : `create ${stateRef}\0${metadata}\0`,
    ...[...expected].map(([ref, revision]) => `verify ${ref}\0${revision}\0`),
    ...[...changed].map(([ref, revision]) =>
      getSha(ref)
        ? `verify ${ref}\0${revision}\0`
        : `create ${ref}\0${revision}\0`
    ),
    ...retired.map(([ref, revision]) => `delete ${ref}\0${revision}\0`),
  ];
  runGitCommand({
    args: ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin', '-z'],
    options: {
      input: ['start\0', ...updates, 'prepare\0', 'commit\0'].join(''),
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

/** Display uses the captured local graph, while mutation checks read live refs. */
export function projectSyncReconciliationDisplay(
  entries: readonly SyncReconciliation[],
  edges: readonly StackEdge[]
): readonly { entry: SyncReconciliation; branches: ReadonlySet<string> }[] {
  const children = indexChildren(edges);
  return entries.map((entry) => {
    const branches = new Set<string>();
    addLocalDescendants(branches, children, [
      entry.branch,
      entry.formerParent,
      ...(entry.dependents ?? []),
    ]);
    return { entry, branches };
  });
}

/** Retain branches connected only by a proposed PR base; local edges stay live. */
export function extendSyncReconciliation(
  entries: readonly SyncReconciliation[],
  edges: { local: readonly StackEdge[]; incoming: readonly StackEdge[] }
): readonly SyncReconciliation[] {
  const local = indexChildren(edges.local);
  const incoming = indexChildren(edges.incoming);
  const freshIncoming = new Set(
    edges.incoming.map(({ branchName }) => branchName)
  );
  return entries.map((entry) => {
    const dependents = new Set(
      entry.dependents?.filter((name) => !freshIncoming.has(name))
    );
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
    return dependents.size === (entry.dependents?.length ?? 0) &&
      [...dependents].every((name) => entry.dependents?.includes(name))
      ? entry
      : {
          ...entry,
          dependents: dependents.size ? [...dependents].sort() : undefined,
        };
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
  reconciliationBranchName.parse(result.trunk);
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
  const neededPins = reconciliationPins(remaining);
  const retired = [...reconciliationPins([entry])]
    .filter(([ref]) => !neededPins.has(ref))
    .map(([ref, revision]) => `delete ${ref}\0${revision}\0`);
  runGitCommand({
    args: ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin', '-z'],
    options: {
      input: [
        'start\0',
        metadata
          ? `update ${stateRef}\0${metadata}\0${before.revision}\0`
          : `delete ${stateRef}\0${before.revision}\0`,
        `verify refs/heads/${entry.branch}\0${result.head}\0`,
        `verify refs/heads/${result.trunk}\0${result.onto}\0`,
        `verify refs/branch-metadata/${entry.branch}\0${result.metadata}\0`,
        ...retired,
        'prepare\0',
        'commit\0',
      ].join(''),
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

export function assertBranchNotPendingReconciliation(
  branch: string,
  entries = readSyncReconciliation().entries
): void {
  if (isPendingSyncReconciliation(branch, entries))
    throw new ExitFailedError(
      `Cannot modify ${branch} while it has pending reconciliation. Inspect the affected branches with an log.`
    );
}
