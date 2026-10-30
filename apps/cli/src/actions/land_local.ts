import fs from 'fs';
import path from 'path';
import { TContext, initContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import { assertNoGitOperation } from '../lib/git/assert_no_operation';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { composeGit } from '../lib/git/git';
import {
  LandingProgress,
  current,
  owned,
  landingGit as git,
} from '../lib/landing_progress';

export function validateLocal(
  record: LandingProgress,
  context: TContext
): void {
  assertNoGitOperation('land');
  if (record.replay)
    throw new ExitFailedError(
      'Saved local replay is incomplete without an active Git rebase. Inspect reached refs and metadata in the original project; recovery preserved.'
    );
  if (!composeGit().getCurrentBranchName())
    throw new ExitFailedError(
      'Landing requires a physically checked-out branch.'
    );
  if (
    fs.existsSync(path.resolve(git(['rev-parse', '--git-path', '.gtcontinue'])))
  )
    throw new ExitFailedError('Saved unrelated recovery exists; preserved.');
  if (git(['status', '--porcelain=v1', '--untracked-files=normal']))
    throw new ExitFailedError(
      'Clean index/worktree required, including untracked files.'
    );
  const engine = initContext(context, composeGit(), {
    inspection: true,
  }).engine;
  engine.assertBranchEditable(record.trunk);
  const all = [...record.merges, ...record.maintenance];
  const names = new Set(all.map((member) => member.branch));
  for (const member of all) {
    const expected = owned(member);
    const head = ref(`refs/heads/${member.branch}`);
    const metadata = ref(`refs/branch-metadata/${member.branch}`);
    if (
      !head &&
      !metadata &&
      (member.result ||
        (member.branch === current(record).branch &&
          record.phase !== 'prepared'))
    )
      continue;
    if (head !== expected.head || metadata !== expected.metadata)
      throw new ExitFailedError(
        'Local target or metadata changed; recovery preserved.'
      );
    engine.assertBranchEditable(member.branch);
    if (
      engine.getParentPrecondition(member.branch) !== expected.parent ||
      engine
        .getChildrenPrecondition(member.branch)
        .some((child) => !names.has(child))
    )
      throw new ExitFailedError(
        'Landing scope changed; no undisclosed descendants may be edited.'
      );
  }
  assertBranchesAvailableInWorktrees([
    record.trunk,
    ...all.map((member) => member.branch),
  ]);
}

function ref(name: string): string {
  return (
    git(['for-each-ref', '--format=%(objectname)', name]).split('\n')[0] || ''
  );
}
