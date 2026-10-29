import fs from 'fs';
import path from 'path';

import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { SCOPE } from '../lib/engine/scope_spec';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { getAbsorbRoot, readAbsorbGit } from './absorb_git';
import {
  AbsorbTarget,
  AbsorbLeftover,
  AbsorbCandidate,
  selectAbsorbFile,
  assertAbsorbTargetsCompatible,
} from './absorb_select';
import { AbsorbHunk } from './absorb_hunks';

export type AbsorbPlan = {
  readonly source: string;
  readonly targets: readonly AbsorbTarget[];
  readonly leftovers: readonly AbsorbLeftover[];
  readonly replay: readonly string[];
};

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
    if (fs.existsSync(path.resolve(getAbsorbRoot(), file)))
      throw new PreconditionsFailedError(
        'Absorb requires no active Git or Anthracite recovery operation. Finish or inspect the existing operation first.'
      );
  }
  if (readAbsorbGit(['ls-files', '--unmerged', '-z']))
    throw new PreconditionsFailedError('Absorb requires a resolved index.');
  if (readAbsorbGit(['rev-parse', '--shared-index-path']).trim())
    throw new PreconditionsFailedError(
      'Absorb does not support split indexes.'
    );
  const intent = [
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
  ];
  if (
    readAbsorbGit([...intent, '--ita-visible-in-index']) !==
    readAbsorbGit([...intent, '--ita-invisible-in-index'])
  )
    throw new PreconditionsFailedError(
      'Absorb does not support intent-to-add index entries.'
    );
  if (/^[a-zS] /m.test(readAbsorbGit(['ls-files', '-v'])))
    throw new PreconditionsFailedError(
      'Absorb does not support skip-worktree or assume-unchanged index entries.'
    );
}

function corridorCommits(
  context: TContext,
  source: string
): readonly AbsorbCandidate[] {
  const candidates: AbsorbCandidate[] = [];
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
    const commits = readAbsorbGit(['rev-list', `${base}..${tip}`])
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) candidates.push({ commit, branch });
    if (!commits.length && context.engine.isBranchFrozen(branch))
      candidates.push({ commit: null, branch });
    branch = parent;
  }
  return candidates;
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
  const targets: AbsorbTarget[] = [];
  const leftovers: AbsorbLeftover[] = [];
  for (const file of files) {
    for (const selected of selectAbsorbFile(file, candidates, context)) {
      if ('commit' in selected) targets.push(selected);
      else leftovers.push(selected);
    }
  }
  assertAbsorbTargetsCompatible(targets);
  const replay = orderReplay(
    [
      ...new Set(
        targets.flatMap((target) =>
          context.engine.getRelativeStack(target.branch, SCOPE.UPSTACK)
        )
      ),
    ],
    context
  );
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
  assertBranchesAvailableInWorktrees([...replay]);
  return { source, targets, leftovers, replay };
}

function orderReplay(
  names: readonly string[],
  context: TContext
): readonly string[] {
  const remaining = new Set(names);
  const ordered: string[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(
        (name) => !remaining.has(context.engine.getParentPrecondition(name))
      )
      .sort();
    if (!ready.length)
      throw new PreconditionsFailedError(
        'Absorb replay tracking contains a cycle.'
      );
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
    }
  }
  return ordered;
}

export function printAbsorbPlan(plan: AbsorbPlan): void {
  if (!plan.targets.length && !plan.leftovers.length) {
    process.stdout.write('No staged changes to absorb.\n');
    return;
  }
  for (const target of plan.targets)
    process.stdout.write(
      `${target.path}: absorb into ${target.branch}, commit ${
        target.commit
      } (${hunkLocation(target.sourceHunk)})\n`
    );
  for (const leftover of plan.leftovers)
    process.stdout.write(
      `Retained ${leftover.path}: ${leftover.reason}${
        leftover.sourceHunk ? ` (${hunkLocation(leftover.sourceHunk)})` : ''
      }\n`
    );
  process.stdout.write(
    `Absorbable hunks: ${plan.targets.length}. Retained hunks: ${
      plan.leftovers.filter((item) => item.kind === 'hunk').length
    }. Retained entries: ${
      plan.leftovers.filter((item) => item.kind === 'entry').length
    }.\n`
  );
  process.stdout.write(
    `Required replay: ${
      plan.replay.join(', ') || 'none'
    }.\nDry run complete; no changes applied.\n`
  );
}

function hunkLocation(hunk: AbsorbHunk): string {
  if (!hunk.oldLines.length)
    return hunk.at
      ? `insertion after source line ${hunk.at}`
      : 'insertion at start of source';
  return hunk.oldLines.length === 1
    ? `source line ${hunk.at + 1}`
    : `source lines ${hunk.at + 1}-${hunk.at + hunk.oldLines.length}`;
}
