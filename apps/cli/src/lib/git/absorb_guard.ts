import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { PreconditionsFailedError } from '../errors';
import { runGitCommand } from './runner';
import { assertBranchesAvailableInWorktrees } from './worktrees';

const oid = z.string().regex(/^[a-f0-9]{40,64}$/);
const recordSchema = z.object({
  owner: z.literal('anthracite-absorb'),
  root: z.string(),
  expected: z.array(
    z.object({ ref: z.string().regex(/^refs\/(heads|branch-metadata)\//), oid })
  ),
  active: z.string(),
  participants: z.array(z.string()),
  failure: z.string().optional(),
});
export type AbsorbGuard = z.infer<typeof recordSchema>;
let activeGuard: string | undefined;

/** Only absorb supplies this opt-in guard to the ordinary same-build hooks. */
export function withAbsorbGuard<T>(file: string, run: () => T): T {
  const previous = activeGuard;
  activeGuard = file;
  try {
    return run();
  } finally {
    activeGuard = previous;
  }
}
export function getAbsorbGuard(): string | undefined {
  return activeGuard;
}
export function readAbsorbGuard(file: string): AbsorbGuard {
  const value = recordSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const sourceEnv = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
  ])
    delete sourceEnv[key];
  const common = runGitCommand({
    args: [
      '-C',
      value.root,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ],
    onError: 'throw',
    resource: 'absorbGuardOwnership',
    options: { env: sourceEnv },
  });
  const sourceAdministration = runGitCommand({
    args: ['-C', value.root, 'rev-parse', '--absolute-git-dir'],
    onError: 'throw',
    resource: 'absorbGuardOwnership',
    options: { env: sourceEnv },
  });
  const currentCommon = runGitCommand({
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    onError: 'throw',
    resource: 'absorbGuardOwnership',
  });
  const directory = path.dirname(fs.realpathSync(file));
  if (
    fs.realpathSync(common) !== fs.realpathSync(currentCommon) ||
    path.dirname(directory) !== fs.realpathSync(sourceAdministration) ||
    !path.basename(directory).startsWith('an-absorb-') ||
    path.basename(file) !== 'guard.json'
  )
    throw new PreconditionsFailedError('Invalid owned absorb guard location.');
  return value;
}

/** A committed hook records only our active participant's actual completed writes. */
export function checkAbsorbGuard(
  file: string,
  phase: string,
  input: Buffer
): void {
  const record = readAbsorbGuard(file);
  if (record.failure) throw new PreconditionsFailedError(record.failure);
  const updates = input
    .toString('utf8')
    .split('\n')
    .map((line) => line.split(' '));
  if (phase === 'committed') {
    for (const [old, next, ref] of updates) {
      if (
        ref !== `refs/heads/${record.active}` &&
        ref !== `refs/branch-metadata/${record.active}`
      )
        continue;
      // Git encodes verify-only entries with a zero new OID.
      if (/^0+$/.test(next ?? '')) continue;
      const entry = record.expected.find((item) => item.ref === ref);
      if (!entry || entry.oid !== old || !oid.safeParse(next).success)
        throw new PreconditionsFailedError(
          'Unexpected completed absorb ref transaction.'
        );
      entry.oid = next;
    }
  }
  try {
    assertBranchesAvailableInWorktrees(record.participants, record.root);
    for (const entry of record.expected) {
      const actual = runGitCommand({
        args: [
          '--no-optional-locks',
          '-C',
          record.root,
          'rev-parse',
          '--verify',
          entry.ref,
        ],
        onError: 'throw',
        resource: 'absorbGuardExpected',
      });
      if (actual !== entry.oid)
        throw new PreconditionsFailedError(
          `Absorb expected ref changed: ${entry.ref}. External changes are retained.`
        );
    }
  } catch (error: unknown) {
    record.failure = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(file, JSON.stringify(record));
    throw error;
  }
  if (phase === 'committed') fs.writeFileSync(file, JSON.stringify(record));
}

export function recordAbsorbHookFailure(file: string, status: number): void {
  const record = readAbsorbGuard(file);
  record.failure = `A committed reference hook failed with exit ${status}; own completed writes remain published.`;
  fs.writeFileSync(file, JSON.stringify(record));
}
