import { TContext } from '../lib/context';
import { getCurrentBranchName } from '../lib/git/branch_ops';
import { uncommittedTrackedChangesPrecondition } from '../lib/preconditions';
import { TContinueConfig } from '../lib/spiffy/continuation_spf';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { runGitCommand } from '../lib/git/runner';
import { PreconditionsFailedError } from '../lib/errors';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { readMetadataRef } from '../lib/engine/metadata_ref';

/** Resolve mandatory blockers before continuation can stage or repair anything. */
export function assertFileSplitAvailable(data: TContinueConfig['data']): void {
  const split = data.split;
  if (!split) return;
  for (const expected of split.expected ?? []) {
    if (readRef(expected.name) !== expected.revision)
      throw new PreconditionsFailedError(
        `Expected file-split ref ${expected.name} changed. Extraction and completed restacks remain. Preserve the resolution and inspect refs before retrying.`
      );
  }
  const pending = split.mandatory.filter(
    (name) => !split.completed.includes(name)
  );
  assertBranchesAvailableInWorktrees([split.source, ...pending]);
  assertRestackFilesAvailable({
    branches: pending.map((name) => {
      const from =
        split.expected?.find((entry) => entry.name === name)?.from ??
        readMetadataRef(name).parentBranchRevision;
      if (!from)
        throw new PreconditionsFailedError(
          `Missing file-split replay base for ${name}. Inspect tracking before retrying.`
        );
      return { name, from };
    }),
    checkoutRevisions: [split.source, ...pending].map(
      (name) => `refs/heads/${name}`
    ),
    skipTrackedPaths: true,
    operation: 'split',
  });
}

export function recordFileSplitCompletion(
  branch: string,
  context: TContext
): void {
  if (!context.continueConfig.data.split) return;
  const revision = readRef(branch);
  context.continueConfig.update((data) => {
    const split = data.split;
    if (!split) return;
    if (!split.completed.includes(branch)) split.completed.push(branch);
    split.expected = split.expected?.map((entry) =>
      entry.name === branch ? { ...entry, revision } : entry
    );
  });
}

function readRef(name: string): string {
  return runGitCommand({
    args: ['rev-parse', '--verify', `refs/heads/${name}`],
    options: { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    onError: 'ignore',
    resource: 'fileSplitCheckpoint',
  });
}

export function reportFileSplitPublicationFailure(
  names: readonly string[],
  context: TContext
): void {
  context.splog.warn(
    [
      'File split extraction publication failed. Inspect actual saved refs and tracking before further changes; hook effects are not rolled back.',
      ...[...new Set(names)].map((name) => {
        const metadata = readMetadataRef(name);
        return `Saved branch: ${name}; ref: ${
          readRef(name) || 'missing'
        }; parent: ${metadata.parentBranchName ?? 'none'}; base: ${
          metadata.parentBranchRevision ?? 'none'
        }.`;
      }),
    ].join('\n')
  );
}

/** Diagnostics never rewrite a paused resolution or its continuation bytes. */
export function reportFileSplitFailure(
  context: TContext,
  phase = 'descendant replay'
): void {
  const split = context.continueConfig.data.split;
  if (!split) return;
  const remaining = split.mandatory.filter(
    (name) => !split.completed.includes(name)
  );
  const active = context.engine.rebaseInProgress()
    ? context.engine.getRebaseHead()
    : undefined;
  const lines = [
    `File split is incomplete (${phase}). Extraction into ${split.parent} is complete; ${split.source} is retained. Completed work remains.`,
    `Completed branches: ${split.completed.join(', ') || 'none'}.`,
    `Remaining branches: ${remaining.join(', ') || 'none'}.`,
    `Current checkout: ${
      getCurrentBranchName() ?? 'detached HEAD'
    }. Active replay: ${active ?? 'none'}.`,
  ];
  if (active)
    lines.push(
      'Resolve the conflict, git add the resolution and run an continue. an rebase --abort only cancels the active rebase; extraction and completed restacks remain.'
    );
  lines.push(
    'After abort, or after preserving blocking work and resolving the Git/hook error, retry remaining branches in this order (resolve and an continue any new conflict before the next command):',
    ...remaining.map((name) => `an restack --branch ${quote(name)} --only`),
    `an checkout ${quote(split.source)}`
  );
  context.splog.warn(lines.join('\n'));
}

export function finishFileSplit(context: TContext): void {
  const split = context.continueConfig.data.split;
  if (!split) return;
  assertFileSplitAvailable(context.continueConfig.data);
  uncommittedTrackedChangesPrecondition();
  if (getCurrentBranchName() !== split.source)
    context.engine.checkoutBranch(split.source, { preserveIgnored: true });
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
