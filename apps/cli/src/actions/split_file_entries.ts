import { PreconditionsFailedError } from '../lib/errors';
import { execFileSync } from 'child_process';
import { TextDecoder } from 'util';

export type FileSplitEntry = {
  readonly path: string;
  readonly mode: string;
  readonly oid: string;
};

/** Validate the full projected tree before an owned index or hook is created. */
export function getFileSplitEntries({
  parentRevision,
  sourceRevision,
  changedPaths,
  selectedPaths,
}: {
  readonly parentRevision: string;
  readonly sourceRevision: string;
  readonly changedPaths: readonly string[];
  readonly selectedPaths: readonly string[];
}): readonly FileSplitEntry[] {
  const parent = readTree(parentRevision);
  const source = readTree(sourceRevision);
  if (
    changedPaths.some(
      (file) =>
        parent.get(file)?.mode === '160000' ||
        source.get(file)?.mode === '160000'
    )
  )
    throw new PreconditionsFailedError(
      'Cannot split a source delta containing changed gitlink entries.'
    );
  const projected = new Map(parent);
  const selected = selectedPaths.map((file) => {
    const entry = source.get(file);
    if (entry) projected.set(file, entry);
    else projected.delete(file);
    return entry ?? { path: file, mode: '0', oid: '0'.repeat(40) };
  });
  for (const file of projected.keys()) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (!projected.has(parts.slice(0, i).join('/'))) continue;
      throw new PreconditionsFailedError(
        'Cannot split this partial file/directory replacement. Select the dependent paths together.'
      );
    }
  }
  return selected;
}

function readTree(revision: string): Map<string, FileSplitEntry> {
  const output = readFileSplitPathRecords([
    'ls-tree',
    '--full-tree',
    '-rz',
    revision,
  ]);
  return new Map(
    output
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const tab = record.indexOf('\t');
        const [mode, , oid] = record.slice(0, tab).split(' ');
        const file = record.slice(tab + 1);
        return [file, { path: file, mode, oid }];
      })
  );
}

/** Git paths are bytes; replacement decoding could silently select another name. */
export function readFileSplitPathRecords(args: readonly string[]): string {
  const output = execFileSync('git', args, {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 1024,
  });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      output
    );
  } catch {
    throw new PreconditionsFailedError(
      'Cannot split paths whose Git records are not valid UTF-8. No split changes were made.'
    );
  }
}
