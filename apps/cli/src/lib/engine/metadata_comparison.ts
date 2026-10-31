import { isDeepStrictEqual } from 'util';
import { z } from 'zod';
import { runGitCommand } from '../git/runner';

/** Freeze status may change independently; topology and PR identity may not. */
export function sameMetadataExceptFrozen(
  current: string,
  expected: string
): boolean {
  if (current === expected) return true;
  if (!current || !expected) return false;
  const withoutFreeze = (oid: string): unknown => {
    const value = z.record(z.string(), z.unknown()).parse(
      JSON.parse(
        runGitCommand({
          args: ['cat-file', '-p', oid],
          onError: 'throw',
          resource: 'compareMetadata',
        })
      )
    );
    if (value.frozen !== undefined && typeof value.frozen !== 'boolean')
      throw new Error('Invalid frozen metadata.');
    delete value.frozen;
    return value;
  };
  try {
    return isDeepStrictEqual(withoutFreeze(current), withoutFreeze(expected));
  } catch {
    return false;
  }
}
