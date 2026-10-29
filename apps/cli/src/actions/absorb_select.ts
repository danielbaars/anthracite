import { PreconditionsFailedError } from '../lib/errors';
import { TContext } from '../lib/context';
import { absorbDiffOptions, readAbsorbBlob, readAbsorbGit } from './absorb_git';
import {
  AbsorbHunk,
  absorbLines,
  applyAbsorbHunk,
  commuteAbsorbHunk,
  parseAbsorbHunks,
} from './absorb_hunks';

export type AbsorbTarget = {
  readonly branch: string;
  readonly commit: string;
  readonly path: string;
  readonly blob: string;
  readonly hunk: AbsorbHunk;
  readonly sourceHunk: AbsorbHunk;
};
export type AbsorbCandidate = {
  readonly branch: string;
  readonly commit: string | null;
};
export type AbsorbLeftover = {
  readonly path: string;
  readonly reason: string;
  readonly kind: 'hunk' | 'entry';
  readonly sourceHunk?: AbsorbHunk;
};

type Entry = { readonly mode: string; readonly oid: string };

function entryAt(commit: string, file: string): Entry | null {
  const raw = readAbsorbGit([
    'ls-tree',
    '-z',
    '--full-tree',
    commit,
    '--',
    file,
  ]);
  if (!raw) return null;
  const [mode, , oid] = raw.slice(0, raw.indexOf('\t')).split(' ');
  if (!mode || !oid)
    throw new PreconditionsFailedError('Cannot read this absorb tree entry.');
  return { mode, oid };
}

function assertAttributes(file: string): void {
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
      (value, i) => i % 3 === 2 && value !== 'unspecified' && value !== 'unset'
    )
  )
    throw new PreconditionsFailedError(
      'Absorb does not yet support content filters or working-tree encodings.'
    );
}

function selectHunk(input: {
  readonly file: string;
  readonly source: AbsorbHunk;
  readonly candidates: readonly AbsorbCandidate[];
  readonly context: TContext;
}): AbsorbTarget | AbsorbLeftover {
  const { file, source, candidates, context } = input;
  const retained = (reason: string): AbsorbLeftover => ({
    path: file,
    reason,
    kind: 'hunk',
    sourceHunk: source,
  });
  let hunk = source;
  for (const { commit, branch } of candidates) {
    if (context.engine.isBranchFrozen(branch))
      return retained('No eligible feature commit before the frozen boundary.');
    if (commit === null) continue;
    const afterEntry = entryAt(commit, file);
    const beforeEntry = entryAt(`${commit}^`, file);
    if (afterEntry?.oid === beforeEntry?.oid) continue;
    if (!afterEntry || !['100644', '100755'].includes(afterEntry.mode))
      return retained('Unsupported historical entry.');
    const after = readAbsorbBlob(afterEntry.oid);
    if (after === null || !applyAbsorbHunk(absorbLines(after), hunk))
      return retained('The hunk cannot be placed exactly.');
    if (!beforeEntry)
      return {
        branch,
        commit,
        path: file,
        blob: afterEntry.oid,
        hunk,
        sourceHunk: source,
      };
    const before = readAbsorbBlob(beforeEntry.oid);
    if (before === null || beforeEntry.mode !== afterEntry.mode)
      return retained('Unsupported historical entry.');
    const changes = parseAbsorbHunks(
      readAbsorbGit([
        'diff',
        ...absorbDiffOptions,
        `${commit}^`,
        commit,
        '--',
        file,
      ])
    );
    const result = commuteAbsorbHunk({
      before: absorbLines(before),
      after: absorbLines(after),
      changes,
      hunk,
    });
    if (result.kind === 'owner')
      return {
        branch,
        commit,
        path: file,
        blob: afterEntry.oid,
        hunk,
        sourceHunk: source,
      };
    if (result.kind === 'unknown')
      return retained('Ambiguous or unrepresentable historical context.');
    hunk = result.hunk;
  }
  return retained('No eligible feature commit owns this correction.');
}

export function assertAbsorbTargetsCompatible(
  targets: readonly AbsorbTarget[]
): void {
  const groups = new Map<string, AbsorbTarget[]>();
  for (const target of targets) {
    const key = `${target.commit}\0${target.path}`;
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const text = readAbsorbBlob(first.blob);
    if (text === null)
      throw new PreconditionsFailedError(
        'Cannot prove the selected target text.'
      );
    let lines = absorbLines(text);
    let boundary = lines.length + 1;
    for (const target of group.sort((a, b) => b.hunk.at - a.hunk.at)) {
      if (
        target.blob !== first.blob ||
        target.hunk.at === boundary ||
        target.hunk.at + target.hunk.oldLines.length > boundary
      )
        throw new PreconditionsFailedError(
          'Selected hunks cannot be combined exactly.'
        );
      const next = applyAbsorbHunk(lines, target.hunk);
      if (!next)
        throw new PreconditionsFailedError(
          'Selected hunks cannot be combined exactly.'
        );
      lines = next;
      boundary = target.hunk.at;
    }
  }
}

export function selectAbsorbFile(
  file: string,
  candidates: readonly AbsorbCandidate[],
  context: TContext
): readonly (AbsorbTarget | AbsorbLeftover)[] {
  assertAttributes(file);
  const raw = readAbsorbGit([
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--no-abbrev',
    ...absorbDiffOptions,
    '--',
    file,
  ]);
  const entry = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\0/.exec(raw);
  if (!entry)
    throw new PreconditionsFailedError(
      'Cannot interpret this staged Git entry.'
    );
  if (
    entry[5] !== 'M' ||
    !['100644', '100755'].includes(entry[1]) ||
    entry[1] !== entry[2]
  )
    return [
      {
        path: file,
        reason:
          'Unsupported added, deleted, renamed, mode or type entry change.',
        kind: 'entry',
      },
    ];
  if (readAbsorbBlob(entry[3]) === null || readAbsorbBlob(entry[4]) === null)
    return [
      {
        path: file,
        reason: 'Unsupported binary or non-UTF-8 entry.',
        kind: 'entry',
      },
    ];
  const patch = readAbsorbGit([
    'diff',
    '--cached',
    ...absorbDiffOptions,
    '--',
    file,
  ]);
  const hunks = parseAbsorbHunks(patch);
  if (!hunks.length)
    return [
      { path: file, reason: 'Unsupported non-text entry diff.', kind: 'entry' },
    ];
  return hunks.map((source) =>
    selectHunk({ file, source, candidates, context })
  );
}
