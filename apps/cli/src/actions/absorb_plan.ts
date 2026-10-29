import fs from 'fs';
import path from 'path';

import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { SCOPE } from '../lib/engine/scope_spec';
import { runGitCommand } from '../lib/git/runner';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';

export type AbsorbTarget = {
  readonly branch: string;
  readonly commit: string;
  readonly path: string;
  readonly patch: string;
};
export type AbsorbLeftover = {
  readonly path: string;
  readonly reason: string;
};
export type AbsorbPlan = {
  readonly source: string;
  readonly targets: readonly AbsorbTarget[];
  readonly leftovers: readonly AbsorbLeftover[];
  readonly replay: readonly string[];
};

/** Keep preview Git reads from refreshing the real index or invoking diff tools. */
export function readAbsorbGit(args: readonly string[]): string {
  return runGitCommand({
    args: [
      '--no-optional-locks',
      '-c',
      'diff.autoRefreshIndex=false',
      '-c',
      'core.fsmonitor=false',
      ...args,
    ],
    options: { noTrim: true },
    onError: 'throw',
    resource: 'absorbInspection',
  });
}

function assertNoActiveOperation(context: TContext): void {
  if (context.continueConfig.path && fs.existsSync(context.continueConfig.path))
    throw new PreconditionsFailedError(
      'Absorb requires no active Git or Anthracite recovery operation. Finish or inspect the existing operation first.'
    );
  for (const name of [
    'rebase-merge',
    'rebase-apply',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
    '.gtcontinue',
  ]) {
    const file = readAbsorbGit(['rev-parse', '--git-path', name]).trim();
    if (fs.existsSync(path.resolve(file)))
      throw new PreconditionsFailedError(
        'Absorb requires no active Git or Anthracite recovery operation. Finish or inspect the existing operation first.'
      );
  }
  if (readAbsorbGit(['ls-files', '--unmerged', '-z']))
    throw new PreconditionsFailedError('Absorb requires a resolved index.');
  if (/^[a-zS] /m.test(readAbsorbGit(['ls-files', '-v'])))
    throw new PreconditionsFailedError(
      'Absorb does not support skip-worktree or assume-unchanged index entries.'
    );
}

function corridorCommits(
  context: TContext,
  source: string
): Map<string, string> {
  const candidates = new Map<string, string>();
  const seen = new Set<string>();
  let branch = source;
  while (!context.engine.isTrunk(branch)) {
    if (seen.has(branch))
      throw new PreconditionsFailedError('Absorb tracking contains a cycle.');
    seen.add(branch);
    const parent = context.engine.getParentPrecondition(branch);
    const parentTip = context.engine.getRevision(parent);
    const base = context.engine.getBaseRevision(branch);
    if (base !== parentTip)
      throw new PreconditionsFailedError(
        `Absorb requires ${branch} restacked on ${parent}. Restack deliberately before retrying.`
      );
    const tip = context.engine.getRevision(branch);
    const ancestry = readAbsorbGit(['merge-base', base, tip]).trim();
    if (ancestry !== base)
      throw new PreconditionsFailedError('Absorb requires linear ancestry.');
    if (
      readAbsorbGit(['rev-list', '--min-parents=2', `${base}..${tip}`]).trim()
    )
      throw new PreconditionsFailedError(
        'Absorb does not support merge history.'
      );
    for (const commit of readAbsorbGit(['rev-list', `${base}..${tip}`])
      .trim()
      .split('\n')
      .filter(Boolean))
      candidates.set(commit, branch);
    branch = parent;
  }
  return candidates;
}

// shortcut: this first preview slice supports one line; #41 expands selection.
function simpleTarget(
  file: string,
  candidates: ReadonlyMap<string, string>
): AbsorbTarget | AbsorbLeftover {
  const attributes = readAbsorbGit([
    'check-attr',
    '-z',
    'filter',
    'working-tree-encoding',
    '--',
    file,
  ]).split('\0');
  if (
    attributes.some(
      (value, index) =>
        index % 3 === 2 && value !== 'unspecified' && value !== 'unset'
    )
  )
    throw new PreconditionsFailedError(
      'Absorb does not yet support content filters or working-tree encodings.'
    );
  const entry = readAbsorbGit([
    'diff',
    '--cached',
    '--raw',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--',
    file,
  ]);
  if (!/^:(100644|100755) \1 [0-9a-f]+ [0-9a-f]+ M\t/.test(entry))
    throw new PreconditionsFailedError(
      'This absorb preview requires a modified regular text entry without mode changes. Other entry changes are not supported yet.'
    );
  const patch = readAbsorbGit([
    'diff',
    '--cached',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--no-color',
    '--unified=0',
    '--',
    file,
  ]);
  const hunks = [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm),
  ];
  const hunk = hunks[0];
  if (
    hunks.length !== 1 ||
    !hunk ||
    (hunk[2] !== undefined && hunk[2] !== '1') ||
    (hunk[4] !== undefined && hunk[4] !== '1')
  )
    throw new PreconditionsFailedError(
      'This absorb preview currently supports one existing text-line correction. Wider hunk selection is not available yet.'
    );
  const owner = readAbsorbGit([
    'blame',
    '--no-textconv',
    '--line-porcelain',
    '-L',
    `${hunk[1]},+1`,
    'HEAD',
    '--',
    file,
  ]).split(' ')[0];
  const branch = candidates.get(owner);
  return branch
    ? { branch, commit: owner, path: file, patch }
    : {
        path: file,
        reason: 'No eligible feature commit owns this correction.',
      };
}

export function planAbsorb(context: TContext): AbsorbPlan {
  assertNoActiveOperation(context);
  const source = readAbsorbGit(['branch', '--show-current']).trim();
  if (!source)
    throw new PreconditionsFailedError(
      'Absorb requires an attached tracked branch.'
    );
  if (context.engine.isTrunk(source))
    throw new PreconditionsFailedError('Absorb cannot operate on trunk.');
  if (!context.engine.isBranchTracked(source))
    throw new PreconditionsFailedError(
      'Absorb requires a tracked source branch.'
    );
  const candidates = corridorCommits(context, source);
  const files = readAbsorbGit([
    'diff',
    '--cached',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--name-only',
    '-z',
  ])
    .split('\0')
    .filter(Boolean);
  if (files.length > 1)
    throw new PreconditionsFailedError(
      'This absorb preview currently supports one changed file. Wider selection is not available yet.'
    );
  const targets: AbsorbTarget[] = [];
  const leftovers: AbsorbLeftover[] = [];
  if (files[0]) {
    const selected = simpleTarget(files[0], candidates);
    if ('commit' in selected) {
      if (context.engine.isBranchFrozen(selected.branch))
        leftovers.push({
          path: selected.path,
          reason: 'The destination is frozen.',
        });
      else targets.push(selected);
    } else leftovers.push(selected);
  }
  const replay = [
    ...new Set(
      targets.flatMap((target) =>
        context.engine.getRelativeStack(target.branch, SCOPE.UPSTACK)
      )
    ),
  ];
  for (const branch of replay) {
    context.engine.assertBranchEditable(branch);
    if (
      readAbsorbGit([
        'rev-list',
        '--min-parents=2',
        `${context.engine.getBaseRevision(
          branch
        )}..${context.engine.getRevision(branch)}`,
      ]).trim()
    )
      throw new PreconditionsFailedError(
        'Absorb does not support merge history.'
      );
  }
  assertBranchesAvailableInWorktrees(replay);
  return { source, targets, leftovers, replay };
}

export function printAbsorbPlan(plan: AbsorbPlan): void {
  if (!plan.targets.length && !plan.leftovers.length) {
    process.stdout.write('No staged changes to absorb.\n');
    return;
  }
  for (const target of plan.targets)
    process.stdout.write(
      `${target.path}: absorb into ${target.branch}, commit ${target.commit}\n`
    );
  for (const leftover of plan.leftovers)
    process.stdout.write(`Retained ${leftover.path}: ${leftover.reason}\n`);
  process.stdout.write(
    `Required replay: ${
      plan.replay.join(', ') || 'none'
    }.\nDry run complete; no changes applied.\n`
  );
}
