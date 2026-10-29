export type AbsorbAlignment = {
  readonly isNew: (afterAt: number) => boolean;
  readonly isMapped: (afterAt: number, beforeAt: number) => boolean;
};

/** A canonical diff alone cannot identify which indistinguishable copy changed. */
export function createAbsorbAlignment(
  before: readonly string[],
  after: readonly string[]
): AbsorbAlignment {
  let tables:
    | { forward: readonly Uint32Array[]; reverse: readonly Uint32Array[] }
    | null
    | undefined;
  const getTables = (): typeof tables => {
    if (tables !== undefined) return tables;
    // shortcut: large uncertain alignments stay staged; use linear-space proof if large-file demand requires it.
    tables =
      (before.length + 1) * (after.length + 1) > 4_000_000
        ? null
        : buildTables(before, after);
    return tables;
  };
  const isNew = (at: number): boolean => {
    const token = after[at];
    if (token === undefined) return false;
    if (!before.includes(token)) return true;
    const data = getTables();
    if (!data) return false;
    const length = data.forward[before.length][after.length];
    return !before.some(
      (line, i) =>
        line === token &&
        data.forward[i][at] + 1 + data.reverse[i + 1][at + 1] === length
    );
  };
  const isMapped = (at: number, expected: number): boolean => {
    const data = getTables();
    if (!data || before[expected] !== after[at]) return false;
    const length = data.forward[before.length][after.length];
    let position: number | undefined;
    for (let i = 0; i <= before.length; i++) {
      if (data.forward[i][at] + data.reverse[i][at + 1] === length)
        return false;
      if (
        i < before.length &&
        before[i] === after[at] &&
        data.forward[i][at] + 1 + data.reverse[i + 1][at + 1] === length
      ) {
        if (position !== undefined) return false;
        position = i;
      }
    }
    return position === expected;
  };
  return { isNew, isMapped };
}

function buildTables(
  before: readonly string[],
  after: readonly string[]
): { forward: readonly Uint32Array[]; reverse: readonly Uint32Array[] } {
  const forward = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1)
  );
  const reverse = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1)
  );
  for (let i = 0; i < before.length; i++)
    for (let j = 0; j < after.length; j++)
      forward[i + 1][j + 1] =
        before[i] === after[j]
          ? forward[i][j] + 1
          : Math.max(forward[i][j + 1], forward[i + 1][j]);
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      reverse[i][j] =
        before[i] === after[j]
          ? reverse[i + 1][j + 1] + 1
          : Math.max(reverse[i + 1][j], reverse[i][j + 1]);
  return { forward, reverse };
}
