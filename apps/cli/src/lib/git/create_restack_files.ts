import fs from 'fs';
import path from 'path';
import { ExitFailedError } from '../errors';
import { runGitCommand } from './runner';

/** Protect only paths a planned restack may check out, including ignored work. */
export function assertCreateRestackFilesAvailable(
  branches: readonly string[],
  all: boolean
): void {
  if (branches.length === 0) return;
  const cwd = runGitCommand({
    args: ['rev-parse', '--show-toplevel'],
    onError: 'throw',
    resource: 'createRestackRoot',
  });
  const paths = [
    ...new Set(
      branches.flatMap((branch) =>
        runGitCommand({
          args: ['ls-tree', '-r', '--name-only', '-z', `refs/heads/${branch}`],
          options: { cwd, noTrim: true },
          onError: 'throw',
          resource: 'createRestackPaths',
        })
          .split('\0')
          .filter(Boolean)
          .flatMap((file) => getCheckoutPaths(file, cwd))
      )
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
      options: { cwd },
      onError: 'throw',
      resource: 'createRestackPathCase',
    }) === 'true';
  for (const ignored of all ? [true] : [true, false]) {
    const collision = runGitCommand({
      args: [
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
      options: { cwd, noTrim: true },
      onError: 'throw',
      resource: 'createRestackFileCollisions',
    }).split('\0')[0];
    if (collision) {
      throw new ExitFailedError(
        `Cannot insert: restacking would overwrite ${
          ignored ? 'ignored' : 'untracked'
        } file ${collision}. Move it away or add it intentionally, then retry.`
      );
    }
  }
}

function getCheckoutPaths(file: string, cwd: string): string[] {
  const parts = file.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    const stat = fs.lstatSync(path.join(cwd, parent), {
      throwIfNoEntry: false,
    });
    if (!stat) break;
    if (!stat.isDirectory()) return [file, parent];
  }
  return [file];
}
