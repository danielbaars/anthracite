import fs from 'fs';
import { z } from 'zod';

/** Caller proves ownership (reaped child or exact acquisition and dead PID). */
export function releaseOwnedCacheLockFile(
  file: string,
  pid: number,
  expectedBytes?: string
): void {
  try {
    const bytes = fs.readFileSync(file, 'utf8');
    const parsed: unknown = JSON.parse(bytes);
    const owner = z.object({ pid: z.literal(pid) }).safeParse(parsed);
    if (
      owner.success &&
      (expectedBytes === undefined || bytes === expectedBytes) &&
      fs.lstatSync(file).isFile() &&
      fs.readFileSync(file, 'utf8') === bytes
    )
      fs.unlinkSync(file);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}
