import * as t from '@withgraphite/retype';
import { getAbsorbGuard, readAbsorbGuard } from '../git/absorb_guard';
import { cuteString } from '../utils/cute_string';
import { runGitCommand, runGitCommandAndSplitLines } from '../git/runner';

export const prInfoSchema = t.shape({
  number: t.optional(t.number),
  base: t.optional(t.string),
  url: t.optional(t.string),
  title: t.optional(t.string),
  body: t.optional(t.string),
  state: t.optional(
    t.unionMany([
      t.literal('OPEN' as const),
      t.literal('CLOSED' as const),
      t.literal('MERGED' as const),
    ])
  ),
  reviewDecision: t.optional(
    t.unionMany([
      t.literal('APPROVED' as const),
      t.literal('REVIEW_REQUIRED' as const),
      t.literal('CHANGES_REQUESTED' as const),
    ])
  ),
  isDraft: t.optional(t.boolean),
});
export type TBranchPRInfo = t.TypeOf<typeof prInfoSchema>;

const metaSchema = t.shape({
  frozen: t.optional(t.boolean),
  parentBranchName: t.optional(t.string),
  parentBranchRevision: t.optional(t.string),
  prInfo: t.optional(prInfoSchema),
});
export type TMeta = t.TypeOf<typeof metaSchema>;

export function writeMetadataRef(
  branchName: string,
  meta: TMeta,
  location?: string | { readonly prefix: readonly string[] }
): void {
  const cwd = typeof location === 'string' ? location : undefined;
  const prefix = typeof location === 'object' ? location.prefix : [];
  const guardFile = getAbsorbGuard();
  const expected = guardFile
    ? readAbsorbGuard(guardFile).expected.find(
        (entry) => entry.ref === `refs/branch-metadata/${branchName}`
      )?.oid
    : undefined;
  const metaSha = runGitCommand({
    args: [`hash-object`, `-w`, `--stdin`],
    options: {
      input: cuteString(meta),
      cwd,
    },
    onError: 'throw',
    resource: 'hashMetadataRef',
  });
  runGitCommand({
    args: [
      ...prefix,
      `update-ref`,
      `refs/branch-metadata/${branchName}`,
      metaSha,
      ...(expected ? [expected] : []),
    ],
    options: {
      stdio: 'pipe',
      cwd,
    },
    onError: 'throw',
    resource: 'writeMetadataRef',
  });
}

export function readMetadataRef(branchName: string, cwd?: string): TMeta {
  try {
    const meta = JSON.parse(
      runGitCommand({
        args: [`cat-file`, `-p`, `refs/branch-metadata/${branchName}`],
        options: {
          cwd,
        },
        onError: 'ignore',
        resource: 'readMetadataRef',
      })
    );

    return metaSchema(meta) ? meta : {};
  } catch {
    return {};
  }
}

export function deleteMetadataRef(branchName: string): void {
  runGitCommand({
    args: [`update-ref`, `-d`, `refs/branch-metadata/${branchName}`],
    onError: 'throw',
    resource: 'deleteMetadataRef',
  });
}

export function getMetadataRefList(): Record<string, string> {
  const meta: Record<string, string> = {};
  runGitCommandAndSplitLines({
    args: [
      `for-each-ref`,
      `--format=%(refname:lstrip=2):%(objectname)`,
      `refs/branch-metadata/`,
    ],
    onError: 'throw',
    resource: 'getMetadataRefList',
    options: { noTrim: true },
  })
    .map((line) => line.split(':'))
    .filter(
      (lineSplit): lineSplit is [string, string] =>
        lineSplit.length === 2 && lineSplit.every((s) => s.length > 0)
    )
    .forEach(([branchName, metaSha]) => (meta[branchName] = metaSha));

  return meta;
}

/** Publish status changes together; expected old refs protect concurrent metadata. */
export function writeFrozenMetadata(
  branchNames: readonly string[],
  frozen: boolean
): void {
  const refs = getMetadataRefList();
  const updates = branchNames.flatMap((branchName) => {
    const meta = readMetadataRef(branchName);
    if ((meta.frozen === true) === frozen) return [];
    const previous = refs[branchName];
    if (!previous) throw new Error(`Missing metadata for ${branchName}.`);
    const revision = runGitCommand({
      args: ['hash-object', '-w', '--stdin'],
      options: { input: cuteString({ ...meta, frozen }) },
      onError: 'throw',
      resource: 'hashFrozenMetadata',
    });
    return [
      `update refs/branch-metadata/${branchName}\0${revision}\0${previous}\0`,
    ];
  });
  if (updates.length === 0) return;
  runGitCommand({
    args: ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin', '-z'],
    options: { input: `start\0${updates.join('')}prepare\0commit\0` },
    onError: 'throw',
    resource: 'freezeMetadataRefs',
  });
}
