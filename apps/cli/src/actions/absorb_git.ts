import { execFileSync } from 'child_process';
import { TextDecoder } from 'util';

import { runGitCommand, TRunGitCommandParameters } from '../lib/git/runner';
import { PreconditionsFailedError } from '../lib/errors';

const readOptions = [
  '--no-optional-locks',
  '--literal-pathspecs',
  '-c',
  'diff.autoRefreshIndex=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'diff.relative=false',
];

function decodeGitText(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    return null;
  }
}

export function getAbsorbRoot(): string {
  const value = decodeGitText(
    execFileSync('git', [...readOptions, 'rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
  if (value === null)
    throw new PreconditionsFailedError(
      'Absorb requires valid UTF-8 Git paths.'
    );
  return value.replace(/\r?\n$/, '');
}

let ownedIndex: string | undefined;

/** Restrict a synchronous inspection to a caller-owned prospective index. */
export function withAbsorbIndex<T>(index: string, inspect: () => T): T {
  const previous = ownedIndex;
  ownedIndex = index;
  try {
    return inspect();
  } finally {
    ownedIndex = previous;
  }
}

function readGitBytes(args: readonly string[], input?: string): Buffer {
  return execFileSync('git', [...readOptions, '-C', getAbsorbRoot(), ...args], {
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 1024,
    input,
    env: ownedIndex
      ? { ...process.env, GIT_INDEX_FILE: ownedIndex }
      : process.env,
  });
}

/** Decode structural records strictly; never select a replacement-decoded path. */
export function readAbsorbGit(args: readonly string[], input?: string): string {
  const result = decodeGitText(readGitBytes(args, input));
  if (result === null)
    throw new PreconditionsFailedError(
      'Absorb requires valid UTF-8 Git records.'
    );
  return result;
}

export function readAbsorbBlob(oid: string): string | null {
  const bytes = readGitBytes(['cat-file', 'blob', oid]);
  return bytes.includes(0) ? null : decodeGitText(bytes);
}

export const absorbDiffOptions: readonly string[] = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--no-color',
  '--no-relative',
  '--unified=0',
  '--inter-hunk-context=0',
  '--diff-algorithm=myers',
  '--no-indent-heuristic',
];

export function runAbsorbGit(
  args: string[],
  options: TRunGitCommandParameters['options'] = {}
): string {
  return runGitCommand({
    args: ['--literal-pathspecs', ...args],
    options: { cwd: getAbsorbRoot(), ...options },
    onError: 'throw',
    resource: 'absorb',
  });
}
