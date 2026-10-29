import fs from 'fs';
import path from 'path';
import { ExitFailedError } from '../errors';
import { runGitCommand } from './runner';

/** Protect only paths a planned restack may check out, including ignored work. */
// eslint-disable-next-line max-lines-per-function
export function assertRestackFilesAvailable({
  branches,
  checkoutRevisions = [],
  all = false,
  skipTrackedPaths = false,
  operation,
  cwd: sourceRoot,
}: {
  branches: readonly { name: string; from: string }[];
  checkoutRevisions?: readonly string[];
  all?: boolean;
  skipTrackedPaths?: boolean;
  cwd?: string;
  operation: 'insert' | 'move' | 'fold' | 'reorder' | 'split' | 'absorb';
}): void {
  if (branches.length === 0 && checkoutRevisions.length === 0) return;
  const env = { ...process.env };
  if (sourceRoot)
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_PREFIX',
    ])
      delete env[key];
  const cwd =
    sourceRoot ??
    runGitCommand({
      args: ['rev-parse', '--show-toplevel'],
      onError: 'throw',
      resource: 'restackRoot',
    });
  const plannedPaths = [
    ...new Set([
      ...branches.flatMap(({ name, from }) =>
        [
          runGitCommand({
            args: ['ls-tree', '-r', '--name-only', '-z', `refs/heads/${name}`],
            options: { cwd, noTrim: true, env },
            onError: 'throw',
            resource: 'restackPaths',
          }),
          // Rebase can materialize files that later commits remove from the tip.
          runGitCommand({
            args: [
              'log',
              '--format=',
              '--name-only',
              '-z',
              '--no-renames',
              `${from}..refs/heads/${name}`,
              '--',
            ],
            options: { cwd, noTrim: true, env },
            onError: 'throw',
            resource: 'restackReplayPaths',
          }),
        ]
          .flatMap((output) => output.split('\0'))
          .filter(Boolean)
      ),
      ...checkoutRevisions
        .map((revision) =>
          runGitCommand({
            args: ['ls-tree', '-r', '--name-only', '-z', revision],
            options: { cwd, noTrim: true, env },
            onError: 'throw',
            resource: 'restackCheckoutPaths',
          })
        )
        .flatMap((output) => output.split('\0'))
        .filter(Boolean),
    ]),
  ];
  const paths = [
    ...new Set(
      (skipTrackedPaths
        ? getPathsOutsideIndex(plannedPaths, cwd, {
            env,
            isInspection: operation === 'absorb',
          })
        : plannedPaths
      ).flatMap((file) => getCheckoutPaths(file, cwd))
    ),
  ];
  if (paths.length === 0) return;
  const ignoreCase =
    runGitCommand({
      args: [
        'config',
        '--bool',
        '--default',
        'false',
        '--get',
        'core.ignorecase',
      ],
      options: { cwd, env },
      onError: 'throw',
      resource: 'restackPathCase',
    }) === 'true';
  for (const ignored of all ? [true] : [true, false]) {
    const collision = runGitCommand({
      args: [
        ...(operation === 'absorb'
          ? ['--no-optional-locks', '-c', 'core.fsmonitor=false']
          : []),
        'ls-files',
        '--others',
        ...(ignored ? ['--ignored'] : []),
        '--exclude-standard',
        '-z',
        '--',
        ...paths.map(
          (file) => `:(literal${ignoreCase ? ',icase' : ''})${file}`
        ),
      ],
      options: { cwd, noTrim: true, env },
      onError: 'throw',
      resource: 'restackFileCollisions',
    }).split('\0')[0];
    if (collision) {
      throw new ExitFailedError(
        `Cannot ${operation}: restacking would overwrite ${
          ignored ? 'ignored' : 'untracked'
        } file ${collision}. Move it away or add it intentionally, then retry.`
      );
    }
  }
}

function getCheckoutPaths(file: string, cwd: string): string[] {
  const root = fs.realpathSync.native(cwd);
  const paths = [file];
  const parts = file.split('/');
  let parent = root;
  for (let i = 0; i < parts.length; i++) {
    const requested = path.join(parent, parts[i]);
    const stat = fs.lstatSync(requested, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      // Resolve the link's spelling without following it outside the worktree.
      for (const entry of fs.readdirSync(parent)) {
        const sibling = fs.lstatSync(path.join(parent, entry));
        if (sibling.dev === stat.dev && sibling.ino === stat.ino)
          paths.push(path.relative(root, path.join(parent, entry)));
      }
      break;
    }
    // Git's icase pathspec does not match every alias the host filesystem does.
    // The native primitive returns stored spelling (including Unicode) on Node
    // and the embedded Bun runtime, unlike Node's JavaScript realpath fallback.
    const actual = fs.realpathSync.native(requested);
    paths.push(path.join(path.relative(root, actual), ...parts.slice(i + 1)));
    if (!stat.isDirectory()) {
      paths.push(path.relative(root, actual));
      break;
    }
    parent = actual;
  }
  return paths;
}

function getPathsOutsideIndex(
  files: readonly string[],
  cwd: string,
  {
    env,
    isInspection,
  }: { readonly env: NodeJS.ProcessEnv; readonly isInspection: boolean }
): string[] {
  // Git can list a clean indexed Unicode alias as ignored under its stored
  // spelling. Later phases let Git protect indexed work and check the rest here.
  const indexed = new Set(
    runGitCommand({
      args: [
        ...(isInspection
          ? ['--no-optional-locks', '-c', 'core.fsmonitor=false']
          : []),
        'ls-files',
        '--cached',
        '-z',
        '--',
        ...files.map((file) => `:(literal)${file}`),
      ],
      options: { cwd, noTrim: true, env },
      onError: 'throw',
      resource: 'restackIndexedPaths',
    })
      .split('\0')
      .filter(Boolean)
  );
  return files.filter((file) => !indexed.has(file));
}
