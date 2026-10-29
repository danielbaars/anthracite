import fs from 'fs';
import path from 'path';
import os from 'os';
import { PreconditionsFailedError } from '../lib/errors';
import { withFrozenCommitGuard } from '../lib/git/frozen_commit';
import { AbsorbTarget } from './absorb_select';
import { absorbLines, applyAbsorbHunk } from './absorb_hunks';
import {
  absorbDiffOptions,
  readAbsorbBlob,
  runAbsorbGit as git,
} from './absorb_git';

/** Apply translated hunks to the immutable original commit, never the caller diff. */
export function prepareAbsorbTree(targets: readonly AbsorbTarget[]): string {
  const target = targets[0];
  const trees = new Map<string, string>();
  for (const file of new Set(targets.map((item) => item.path))) {
    const item = targets.find((value) => value.path === file);
    if (!item) continue;
    const original = readAbsorbBlob(item.blob);
    if (original === null)
      throw new PreconditionsFailedError(
        'Selected text is no longer representable.'
      );
    let lines = absorbLines(original);
    for (const hunk of targets
      .filter((value) => value.path === file)
      .map((value) => value.hunk)
      .sort((a, b) => b.at - a.at)) {
      const applied = applyAbsorbHunk(lines, hunk);
      if (!applied)
        throw new PreconditionsFailedError(
          'Selected hunk does not match its original target.'
        );
      lines = applied;
    }
    trees.set(
      file,
      git(['hash-object', '-w', '--stdin'], { input: lines.join('') })
    );
  }
  const previewIndex = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'an-absorb-plan-')),
    'index'
  );
  let amendedTree: string;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: previewIndex };
    git(['read-tree', target.commit], { env });
    for (const [file, oid] of trees) {
      const entry = git(['ls-tree', target.commit, '--', file]);
      git(
        ['update-index', '--add', '--cacheinfo', entry.slice(0, 6), oid, file],
        { env }
      );
    }
    amendedTree = git(['write-tree'], { env });
  } finally {
    fs.rmSync(path.dirname(previewIndex), { recursive: true, force: true });
  }
  return amendedTree;
}

export function prepareAbsorbRange(input: {
  readonly target: AbsorbTarget;
  readonly commits: readonly string[];
  readonly base: string;
  readonly amendedTrees: ReadonlyMap<string, string>;
  readonly worktree: string;
  readonly noVerify: boolean;
  readonly participants: readonly string[];
}): string {
  const {
    target,
    commits,
    base,
    amendedTrees,
    worktree,
    noVerify,
    participants,
  } = input;
  git(['worktree', 'add', '--quiet', '--detach', worktree, base]);
  for (const commit of commits) {
    const before = git(['rev-parse', 'HEAD'], { cwd: worktree });
    git(['cherry-pick', '--no-commit', commit], { cwd: worktree });
    const amendedTree = amendedTrees.get(commit);
    if (amendedTree) {
      // Replay the original delta first, then merge only this commit's correction.
      const correction = git(
        [
          'diff',
          ...absorbDiffOptions,
          '--unified=3',
          '--full-index',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--binary',
          commit,
          amendedTree,
        ],
        { noTrim: true }
      );
      git(['apply', '--3way', '--index'], { cwd: worktree, input: correction });
    }
    const expectedTree = git(['write-tree'], { cwd: worktree });
    withFrozenCommitGuard(
      target.branch,
      (prefix) => {
        git(
          [
            ...prefix,
            'commit',
            '--quiet',
            '--allow-empty',
            '--cleanup=verbatim',
            '--reuse-message',
            commit,
            ...(noVerify ? ['--no-verify'] : []),
          ],
          { cwd: worktree }
        );
      },
      { participants: participants }
    );
    const revision = git(['rev-parse', 'HEAD'], { cwd: worktree });
    if (
      git(['rev-parse', `${revision}^{tree}`], { cwd: worktree }) !==
        expectedTree ||
      git(['show', '-s', '--format=%P', revision], { cwd: worktree }) !==
        before ||
      git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', revision], {
        cwd: worktree,
        noTrim: true,
      }) !==
        git(['show', '-s', '--format=%an%n%ae%n%aI%n%B', commit], {
          noTrim: true,
        })
    )
      throw new PreconditionsFailedError(
        'A hook changed the prepared commit tree, author, message or ancestry.'
      );
    if (
      git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored'], {
        cwd: worktree,
      })
    )
      throw new PreconditionsFailedError(
        'A hook left work in the construction checkout.'
      );
  }
  const revision = git(['rev-parse', 'HEAD'], { cwd: worktree });
  const administration = git(['rev-parse', '--absolute-git-dir'], {
    cwd: worktree,
  });
  if (fs.readdirSync(administration).some((name) => name.endsWith('.lock')))
    throw new PreconditionsFailedError(
      'A foreign Git lock remains in the construction checkout.'
    );
  return revision;
}
