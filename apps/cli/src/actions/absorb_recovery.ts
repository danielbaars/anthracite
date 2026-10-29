import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { readAbsorbGuard, checkAbsorbGuard } from '../lib/git/absorb_guard';
import { assertBranchEditable } from '../lib/engine/frozen_branch';
import { ownsRebase } from '../lib/git/rebase_ownership';
import { TContinueConfig } from '../lib/spiffy/continuation_spf';
import { cacheLockConfigFactory } from '../lib/spiffy/cache_lock_spf';
import {
  getAbsorbRoot,
  readAbsorbGit,
  absorbEnvironmentOverrides,
  assertAbsorbEnvironment,
} from './absorb_git';

const oid = z.string().regex(/^[a-f0-9]{40,64}$/);
const hunk = z.object({
  at: z.number().int().nonnegative(),
  oldLines: z.array(z.string()),
  newLines: z.array(z.string()),
});
const savedSchema = z.object({
  noVerify: z.boolean(),
  plan: z.object({
    source: z.string(),
    replay: z.array(z.string()),
    targets: z.array(
      z.object({
        branch: z.string(),
        commit: oid,
        path: z.string(),
        blob: oid,
        hunk,
        sourceHunk: hunk,
      })
    ),
    leftovers: z.array(
      z.object({
        path: z.string(),
        reason: z.string(),
        kind: z.enum(['hunk', 'entry']),
        sourceHunk: hunk.optional(),
      })
    ),
  }),
  expected: z.array(
    z.object({ name: z.string(), revision: oid, metadata: oid.optional() })
  ),
  ranges: z.array(
    z.object({
      name: z.string(),
      parent: z.string(),
      metadata: z.record(z.string(), z.unknown()),
      base: oid,
      originalTip: oid,
      commits: z.array(oid),
    })
  ),
});
export function readAbsorbExecution(
  directory: string
): z.infer<typeof savedSchema> {
  readAbsorbGuard(path.join(directory, 'guard.json'));
  return savedSchema.parse(
    JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'))
  );
}

/** Find only the physical source's saved role; legacy continue retains its environment policy. */
export function assertAbsorbContinuationEnvironment(): void {
  if (
    !absorbEnvironmentOverrides.some((name) => process.env[name] !== undefined)
  )
    return;
  const env = { ...process.env };
  for (const name of absorbEnvironmentOverrides) delete env[name];
  let root: string;
  try {
    root = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ).replace(/\r?\n$/, '');
  } catch {
    return;
  }
  const file = path.join(root, '.gtcontinue');
  if (!fs.existsSync(file)) return;
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  const saved = z.object({ absorb: z.unknown().optional() }).safeParse(data);
  if (saved.success && saved.data.absorb !== undefined)
    assertAbsorbEnvironment();
}

/** Runs before ordinary context repair and before --all can stage resolutions. */
export function assertAbsorbContinuationAvailable(
  data: TContinueConfig['data']
): void {
  const role = data.absorb;
  if (!role) return;
  assertAbsorbEnvironment();
  const file = path.join(role.directory, 'guard.json');
  const guard = readAbsorbGuard(file);
  if (fs.realpathSync(guard.root) !== fs.realpathSync(getAbsorbRoot()))
    throw new PreconditionsFailedError(
      'Continue absorb in its original source worktree. Retained input: ' +
        role.directory
    );
  if (!ownsRebase(data.rebaseOwnership))
    throw new PreconditionsFailedError(
      'No owned active absorb rebase. Inspect reached work; earlier amendments remain after abort. Retained input and manual restoration: ' +
        path.join(role.directory, 'restore.cjs')
    );
  for (const lock of [
    cacheLockConfigFactory.load(undefined, { preserveInvalid: true }).path,
    path.resolve(
      getAbsorbRoot(),
      readAbsorbGit(['rev-parse', '--git-path', 'index.lock']).trim()
    ),
  ])
    if (fs.existsSync(lock))
      throw new PreconditionsFailedError(
        'Absorb continuation requires the existing lock to be released by its owner: ' +
          lock
      );
  const saved = readAbsorbExecution(role.directory);
  if (
    role.source !== saved.plan.source ||
    JSON.stringify(role.mandatory) !== JSON.stringify(saved.plan.replay)
  )
    throw new PreconditionsFailedError(
      'Absorb continuation does not match its owned plan.'
    );
  // Validate transient blockers without touching saved artifacts on refusal.
  checkAbsorbGuard(file, 'before-mutation', Buffer.alloc(0), true);
  for (const branch of role.mandatory) assertBranchEditable(branch);
}

export function recordAbsorbCompletion(
  branch: string,
  context: TContext
): void {
  const role = context.continueConfig.data.absorb;
  if (!role || role.completed.includes(branch)) return;
  context.continueConfig.update((data) => {
    if (data.absorb) data.absorb.completed.push(branch);
  });
  fs.writeFileSync(
    path.join(role.directory, 'progress.json'),
    JSON.stringify({ completed: context.continueConfig.data.absorb?.completed })
  );
}
