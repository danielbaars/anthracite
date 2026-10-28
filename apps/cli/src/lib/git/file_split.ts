import { runGitCommand } from './runner';
import { withFrozenCommitGuard } from './frozen_commit';
import { readMetadataRef, getMetadataRefList } from '../engine/metadata_ref';
import { cuteString } from '../utils/cute_string';

export type FileSplitPublication = {
  readonly source: string;
  readonly parent: string;
  readonly sourceRevision: string;
  readonly parentRevision: string;
  readonly generatedName: string;
  readonly selectedRevision: string;
  readonly remainderRevision: string;
  readonly descendants: readonly {
    readonly name: string;
    readonly revision: string;
  }[];
};

/** Publish prepared branch names and their identity-preserving tracking together. */
export function publishFileSplitRefs(plan: FileSplitPublication): void {
  const metadata = getMetadataRefList();
  const original = metadata[plan.source];
  if (!original)
    throw new Error(
      'Source tracking disappeared before file split publication.'
    );
  const hash = (value: unknown): string =>
    runGitCommand({
      args: ['hash-object', '-w', '--stdin'],
      options: { input: cuteString(value) },
      onError: 'throw',
      resource: 'fileSplitMetadata',
    });
  const selectedMetadata = hash({
    parentBranchName: plan.parent,
    parentBranchRevision: plan.parentRevision,
  });
  const remainderMetadata = hash({
    ...readMetadataRef(plan.source),
    parentBranchName: plan.generatedName,
    parentBranchRevision: plan.selectedRevision,
  });
  const input = [
    'start\0',
    `create refs/heads/${plan.generatedName}\0${plan.selectedRevision}\0`,
    `update refs/heads/${plan.source}\0${plan.remainderRevision}\0${plan.sourceRevision}\0`,
    `verify refs/heads/${plan.parent}\0${plan.parentRevision}\0`,
    ...plan.descendants.map(
      ({ name, revision }) => `verify refs/heads/${name}\0${revision}\0`
    ),
    `create refs/branch-metadata/${plan.generatedName}\0${selectedMetadata}\0`,
    `update refs/branch-metadata/${plan.source}\0${remainderMetadata}\0${original}\0`,
    'prepare\0commit\0',
  ].join('');
  withFrozenCommitGuard(
    plan.source,
    (prefix) => {
      runGitCommand({
        args: [...prefix, 'update-ref', '--stdin', '-z'],
        options: { input },
        onError: 'throw',
        resource: 'fileSplitRefs',
      });
    },
    {
      participants: [plan.source, ...plan.descendants.map(({ name }) => name)],
      allRefs: true,
    }
  );
}
