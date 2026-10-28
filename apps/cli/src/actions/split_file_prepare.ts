import fs from 'fs';
import os from 'os';
import path from 'path';
import { PreconditionsFailedError } from '../lib/errors';
import { withFrozenCommitGuard } from '../lib/git/frozen_commit';
import { runGitCommand, TRunGitCommandParameters } from '../lib/git/runner';
import { FileSplitPlan } from './split_file_plan';

/** Two ordinary commits run real hooks in an owned detached checkout. */
export function prepareFileSplit(
  plan: FileSplitPlan,
  noVerify: boolean
): {
  readonly selectedRevision: string;
  readonly remainderRevision: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an-file-split-'));
  const worktree = path.join(root, 'worktree');
  const index = path.join(root, 'index');
  try {
    const selectedTree = projectSelectedTree(plan, index);
    const sourceTree = constructionGit([
      'rev-parse',
      `${plan.sourceRevision}^{tree}`,
    ]);
    const commits = constructionGit([
      'rev-list',
      '--reverse',
      `${plan.parentRevision}..${plan.sourceRevision}`,
    ]).split('\n');
    const message =
      commits
        .map((commit) =>
          constructionGit(['show', '-s', '--format=%B', commit]).replace(
            /\n+$/,
            ''
          )
        )
        .join('\n\n') + '\n';
    const messageFile = path.join(root, 'message');
    constructionGit([
      'worktree',
      'add',
      '--quiet',
      '--no-checkout',
      '--detach',
      worktree,
      plan.parentRevision,
    ]);
    const commit = (tree: string, parent: string): string => {
      constructionGit(['read-tree', '--reset', '-u', tree], { cwd: worktree });
      fs.writeFileSync(messageFile, message);
      withFrozenCommitGuard(
        plan.source,
        (prefix) => {
          constructionGit([
            '-C',
            worktree,
            ...prefix,
            'commit',
            '--quiet',
            '--cleanup=verbatim',
            '--file',
            messageFile,
            ...(noVerify ? ['--no-verify'] : []),
          ]);
        },
        {
          participants: [
            plan.source,
            ...plan.descendants.map(({ name }) => name),
          ],
        }
      );
      const revision = constructionGit(['rev-parse', 'HEAD'], {
        cwd: worktree,
      });
      const actualMessage = constructionGit(['cat-file', 'commit', revision], {
        cwd: worktree,
      })
        .split('\n\n')
        .slice(1)
        .join('\n\n');
      if (
        constructionGit(['rev-parse', `${revision}^{tree}`], {
          cwd: worktree,
        }) !== tree ||
        constructionGit(['show', '-s', '--format=%P', revision], {
          cwd: worktree,
        }) !== parent ||
        actualMessage !== message.replace(/\n$/, '')
      )
        throw new PreconditionsFailedError(
          'A hook changed the prepared tree, message or commit ancestry.'
        );
      if (
        constructionGit(
          ['status', '--porcelain=v1', '--untracked-files=all', '--ignored'],
          { cwd: worktree }
        )
      )
        throw new PreconditionsFailedError(
          'A hook left local work in the construction worktree.'
        );
      return revision;
    };
    const selectedRevision = commit(selectedTree, plan.parentRevision);
    const remainderRevision = commit(sourceTree, selectedRevision);
    const administration = constructionGit(
      ['rev-parse', '--absolute-git-dir'],
      { cwd: worktree }
    );
    if (fs.readdirSync(administration).some((name) => name.endsWith('.lock')))
      throw new PreconditionsFailedError(
        'A Git lock remains in the construction worktree.'
      );
    constructionGit(['worktree', 'remove', worktree]);
    fs.unlinkSync(index);
    fs.unlinkSync(messageFile);
    fs.rmdirSync(root);
    return { selectedRevision, remainderRevision };
  } catch (error: unknown) {
    throw new PreconditionsFailedError(
      `File split construction failed before extraction. No split refs were published. Prepared files are retained at ${root}. Inspect current refs and hook effects before retrying. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function constructionGit(
  args: string[],
  options: TRunGitCommandParameters['options'] = {}
): string {
  return runGitCommand({
    args,
    options: { ...options, noTrim: true },
    onError: 'throw',
    resource: 'fileSplitConstruction',
  }).replace(/\n$/, '');
}

function projectSelectedTree(plan: FileSplitPlan, index: string): string {
  const env = { ...process.env, GIT_INDEX_FILE: index };
  constructionGit(['read-tree', plan.parentRevision], { env });
  const entries = new Map(
    constructionGit(['ls-tree', '-rz', plan.sourceRevision])
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const tab = record.indexOf('\t');
        return [record.slice(tab + 1), record.slice(0, tab).split(' ')];
      })
  );
  const records = plan.selectedPaths
    .map((file) => {
      const entry = entries.get(file);
      return entry
        ? `${entry[0]} ${entry[2]}\t${file}\0`
        : `0 ${'0'.repeat(40)}\t${file}\0`;
    })
    .join('');
  constructionGit(['update-index', '-z', '--index-info'], {
    input: records,
    env,
  });
  return constructionGit(['write-tree'], { env });
}
