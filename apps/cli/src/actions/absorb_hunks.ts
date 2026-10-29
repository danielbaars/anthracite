import { PreconditionsFailedError } from '../lib/errors';
import { createAbsorbAlignment } from './absorb_alignment';

export type AbsorbHunk = {
  readonly at: number;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
};

export function absorbLines(text: string): readonly string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function parseAbsorbHunks(patch: string): readonly AbsorbHunk[] {
  const hunks: AbsorbHunk[] = [];
  let active:
    | {
        at: number;
        oldLines: string[];
        newLines: string[];
        oldCount: number;
        newCount: number;
      }
    | undefined;
  let side: '-' | '+' | undefined;
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (active) finishHunk(active, hunks);
      const oldCount = Number(header[2] ?? 1);
      active = {
        at: Number(header[1]) - (oldCount ? 1 : 0),
        oldLines: [],
        newLines: [],
        oldCount,
        newCount: Number(header[4] ?? 1),
      };
      side = undefined;
    } else if (active && line.startsWith('-')) {
      active.oldLines.push(line.slice(1) + '\n');
      side = '-';
    } else if (active && line.startsWith('+')) {
      active.newLines.push(line.slice(1) + '\n');
      side = '+';
    } else if (active && line === '\\ No newline at end of file' && side) {
      const lines = side === '-' ? active.oldLines : active.newLines;
      const last = lines.pop();
      if (last !== undefined) lines.push(last.slice(0, -1));
    }
  }
  if (active) finishHunk(active, hunks);
  return hunks;
}

function finishHunk(
  active: {
    at: number;
    oldLines: readonly string[];
    newLines: readonly string[];
    oldCount: number;
    newCount: number;
  },
  hunks: AbsorbHunk[]
): void {
  if (
    active.oldLines.length !== active.oldCount ||
    active.newLines.length !== active.newCount
  )
    throw new PreconditionsFailedError(
      'Cannot interpret this text hunk exactly.'
    );
  hunks.push({
    at: active.at,
    oldLines: active.oldLines,
    newLines: active.newLines,
  });
}

export function applyAbsorbHunk(
  lines: readonly string[],
  hunk: AbsorbHunk
): readonly string[] | null {
  if (
    hunk.at < 0 ||
    hunk.at + hunk.oldLines.length > lines.length ||
    hunk.oldLines.some((line, i) => line !== lines[hunk.at + i])
  )
    return null;
  return [
    ...lines.slice(0, hunk.at),
    ...hunk.newLines,
    ...lines.slice(hunk.at + hunk.oldLines.length),
  ];
}

type Commute =
  | { readonly kind: 'commute'; readonly hunk: AbsorbHunk }
  | { readonly kind: 'owner' }
  | { readonly kind: 'unknown' };

/** Compare both exact application orders before carrying a hunk into older text. */
export function commuteAbsorbHunk(input: {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly changes: readonly AbsorbHunk[];
  readonly hunk: AbsorbHunk;
}): Commute {
  const { before, after, changes, hunk } = input;
  const alignment = createAbsorbAlignment(before, after);
  let delta = 0;
  for (const change of changes) {
    const at = change.at + delta;
    const end = at + change.newLines.length;
    const hunkEnd = hunk.at + hunk.oldLines.length;
    if (
      hunk.oldLines.length &&
      change.newLines.length &&
      hunk.at < end &&
      hunkEnd > at
    ) {
      for (let i = Math.max(at, hunk.at); i < Math.min(end, hunkEnd); i++)
        if (alignment.isNew(i)) return { kind: 'owner' };
      return { kind: 'unknown' };
    }
    if (!hunk.oldLines.length && at < hunk.at && hunk.at < end)
      return {
        kind:
          alignment.isNew(hunk.at - 1) || alignment.isNew(hunk.at)
            ? 'owner'
            : 'unknown',
      };
    if (
      (!change.newLines.length && at >= hunk.at && at <= hunkEnd) ||
      (!hunk.oldLines.length && (hunk.at === at || hunk.at === end))
    )
      return { kind: 'unknown' };
    if (end <= hunk.at)
      delta += change.newLines.length - change.oldLines.length;
    else if (at >= hunkEnd) break;
  }
  const mapped = { ...hunk, at: hunk.at - delta };
  const amendedBefore = applyAbsorbHunk(before, mapped);
  const amendedAfter = applyAbsorbHunk(after, hunk);
  if (!amendedBefore || !amendedAfter) return { kind: 'unknown' };
  const positions = hunk.oldLines.length
    ? hunk.oldLines.map((_, i) => hunk.at + i)
    : [hunk.at - 1, hunk.at].filter((at) => at >= 0 && at < after.length);
  if (!positions.every((at) => alignment.isMapped(at, at - delta)))
    return { kind: 'unknown' };
  let replay: readonly string[] = amendedBefore;
  for (const change of [...changes].reverse()) {
    const shifted = {
      ...change,
      at:
        change.at +
        (change.at >= mapped.at + mapped.oldLines.length
          ? mapped.newLines.length - mapped.oldLines.length
          : 0),
    };
    const next = applyAbsorbHunk(replay, shifted);
    if (!next) return { kind: 'unknown' };
    replay = next;
  }
  return replay.join('') === amendedAfter.join('')
    ? { kind: 'commute', hunk: mapped }
    : { kind: 'unknown' };
}
