import fs from 'fs';
import path from 'path';
import { SCOPE } from '../lib/engine/scope_spec';
import { TContext } from '../lib/context';
import {
  withAbsorbGuard,
  readAbsorbGuard,
  checkAbsorbGuard,
} from '../lib/git/absorb_guard';
import { cacheLockConfigFactory } from '../lib/spiffy/cache_lock_spf';
import { getCacheLock } from '../lib/engine/cache_lock';
import { assertBranchEditable } from '../lib/engine/frozen_branch';
import { getMetadataRefList } from '../lib/engine/metadata_ref';
import { PreconditionsFailedError } from '../lib/errors';
import { withFrozenCommitGuard } from '../lib/git/frozen_commit';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { AbsorbPlan } from './absorb_plan';
import {
  getAbsorbRoot,
  readAbsorbGit,
  runAbsorbGit as git,
} from './absorb_git';
import { prepareAbsorbTree, prepareAbsorbRange } from './absorb_prepare';
import {
  assertAbsorbInputSupported,
  assertAbsorbInputUnchanged,
  retainAbsorbInput,
  restoreAbsorbInput,
} from './absorb_input';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

type Expected = {
  readonly name: string;
  readonly revision: string;
  readonly metadata: string;
};
function assertExpected(
  expected: readonly Expected[],
  participants: readonly string[]
): void {
  assertBranchesAvailableInWorktrees([...participants]);
  for (const name of participants) assertBranchEditable(name);
  const metadata = getMetadataRefList();
  for (const item of expected)
    if (
      git(['rev-parse', `refs/heads/${item.name}`]) !== item.revision ||
      metadata[item.name] !== item.metadata
    )
      throw new PreconditionsFailedError(
        `Absorb expected refs changed for ${item.name}. Inspect external changes before retrying.`
      );
}

/** One original correction, its remaining own commits, and a mandatory linear chain. */
export function applyAbsorb(
  plan: AbsorbPlan,
  context: TContext,
  noVerify: boolean
): void {
  if (!plan.targets.length) {
    if (!context.quiet) {
      for (const item of plan.leftovers)
        process.stdout.write(`Retained ${item.path}: ${item.reason}\n`);
      process.stdout.write('No eligible staged corrections to absorb.\n');
    }
    return;
  }
  const target = plan.targets[0];
  if (
    new Set(plan.targets.map((item) => item.commit)).size !== 1 ||
    plan.replay.some(
      (name, i) =>
        i > 0 &&
        context.engine.getParentPrecondition(name) !== plan.replay[i - 1]
    )
  )
    throw new PreconditionsFailedError(
      'Multiple target commits and fan-out application are not supported yet. Use --dry-run to inspect the retained input.'
    );
  const parent = context.engine.getParentPrecondition(target.branch);
  const names = [
    ...new Set([
      parent,
      ...context.engine.getRelativeStack(plan.source, SCOPE.DOWNSTACK),
      ...plan.replay,
    ]),
  ];
  const metadata = getMetadataRefList();
  const expected = names.map((name) => ({
    name,
    revision: context.engine.getRevision(name),
    metadata: metadata[name],
  }));
  const base = context.engine.getBaseRevision(target.branch);
  const originalTip = context.engine.getRevision(target.branch);
  const commits = git(['rev-list', '--reverse', `${base}..${originalTip}`])
    .split('\n')
    .filter(Boolean);
  assertAbsorbInputSupported([
    ...new Set(
      plan.replay.flatMap((name) =>
        git([
          'rev-list',
          `${context.engine.getBaseRevision(
            name
          )}..${context.engine.getRevision(name)}`,
        ])
          .split('\n')
          .filter(Boolean)
      )
    ),
  ]);
  const existingLock = cacheLockConfigFactory.load(undefined, {
    preserveInvalid: true,
  });
  if (fs.existsSync(existingLock.path))
    throw new PreconditionsFailedError(
      'Absorb requires the existing cache lock to be released by its owner.'
    );
  const indexLock = path.resolve(
    getAbsorbRoot(),
    readAbsorbGit(['rev-parse', '--git-path', 'index.lock']).trim()
  );
  if (fs.existsSync(indexLock))
    throw new PreconditionsFailedError(
      'Absorb requires the existing index lock to be released by its owner.'
    );
  const amendedTree = prepareAbsorbTree(plan.targets);
  assertRestackFilesAvailable({
    branches: plan.replay.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: [base],
    skipTrackedPaths: true,
    operation: 'absorb',
  });
  const lock = getCacheLock();
  lock.lock();
  try {
    assertExpected(expected, plan.replay);
    executeAbsorb({
      plan,
      context,
      noVerify,
      expected,
      base,
      originalTip,
      commits,
      amendedTree,
    });
  } finally {
    try {
      lock.release();
    } catch (error: unknown) {
      process.stderr.write(
        `WARNING: Cache lock was preserved: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
    }
  }
}

type AbsorbExecution = {
  readonly plan: AbsorbPlan;
  readonly context: TContext;
  readonly noVerify: boolean;
  readonly expected: readonly Expected[];
  readonly base: string;
  readonly originalTip: string;
  readonly commits: readonly string[];
  readonly amendedTree: string;
};
function executeAbsorb(execution: AbsorbExecution): void {
  const {
    plan,
    context,
    noVerify,
    expected,
    base,
    originalTip,
    commits,
    amendedTree,
  } = execution;
  const target = plan.targets[0];
  const input = retainAbsorbInput(plan.source);
  const completed: string[] = [];
  let active = `constructing ${target.branch}`;
  fs.writeFileSync(
    path.join(input.directory, 'plan.json'),
    JSON.stringify({ plan, expected, base, originalTip })
  );
  const worktree = path.join(input.directory, 'construction');
  try {
    const guardFile = createGuard(input.directory, expected, plan);
    withAbsorbGuard(guardFile, () => {
      const revision = prepareAbsorbRange({
        target,
        commits,
        base,
        amendedTree,
        worktree,
        noVerify,
        participants: plan.replay,
      });
      assertExpected(expected, plan.replay);
      assertAbsorbInputUnchanged(input);
      active = `publishing ${target.branch}`;
      publishAbsorbBranch({
        branch: target.branch,
        revision,
        expected,
        participants: plan.replay,
      });
      completed.push(target.branch);
      checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      context.engine.rebuild();
      // The caller's retained work is isolated before establishing the new checkout.
      assertAbsorbInputUnchanged(input);
      git(['read-tree', '--reset', '-u', 'HEAD']);
      for (const name of plan.replay.filter((name) => name !== target.branch)) {
        active = `replaying ${name}`;
        const remaining = plan.replay.filter(
          (value) => !completed.includes(value)
        );
        const guard = readAbsorbGuard(guardFile);
        guard.active = name;
        fs.writeFileSync(guardFile, JSON.stringify(guard));
        checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
        assertBranchesAvailableInWorktrees([...plan.replay]);
        for (const participant of remaining) assertBranchEditable(participant);
        const result = context.engine.restackBranch(name, remaining);
        if (result.result === 'REBASE_CONFLICT')
          throw new PreconditionsFailedError(
            readAbsorbGit(['ls-files', '--unmerged']).trim()
              ? 'Content conflict during mandatory replay.'
              : 'Replay stopped; inspect Git state and hooks.'
          );
        completed.push(name);
        checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      }
      checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      active = 'restoring retained input';
      git(['switch', '--quiet', plan.source]);
      restoreAbsorbInput(input);
      if (!context.quiet) {
        for (const item of plan.leftovers)
          process.stdout.write(`Retained ${item.path}: ${item.reason}\n`);
        process.stdout.write(
          `Absorbed ${plan.targets.length} hunk(s) into ${
            target.branch
          }, original commit ${target.commit}. Replayed: ${
            completed.slice(1).join(', ') || 'none'
          }. Retained input restored.\n`
        );
      }
      git(['worktree', 'remove', worktree]);
      fs.rmSync(input.directory, { recursive: true });
    });
  } catch (error: unknown) {
    recordReachedWrites({
      directory: input.directory,
      plan,
      expected,
      completed,
    });
    const pending = plan.replay.filter((name) => !completed.includes(name));
    fs.writeFileSync(
      path.join(input.directory, 'progress.json'),
      JSON.stringify({ completed, active, pending })
    );
    throw new PreconditionsFailedError(
      `Absorb stopped. Completed: ${
        completed.join(', ') || 'none'
      }. Active: ${active}. Pending: ${
        pending.join(', ') || 'none'
      }. Retained input and construction: ${input.directory}. ${
        error instanceof Error ? error.message : String(error)
      }\nAutomatic absorb continuation is not available yet. Inspect the saved plan/progress and actual refs. Finish or abort the active Git replay deliberately if one exists. Return to ${
        plan.source
      } and restore retained input FIRST by running: ${
        process.versions.bun ? 'BUN_BE_BUN=1 ' : ''
      }${shellQuote(process.execPath)} ${shellQuote(
        path.join(input.directory, 'restore.cjs')
      )}. This restores the original staged/unstaged input only when collision checks pass; save newer work separately first. Pending branches remain stale. Save the restored local work deliberately before a later restack; do not restack before this guarded restoration. Earlier published amendments remain after abort.`
    );
  }
}
function createGuard(
  directory: string,
  expected: readonly Expected[],
  plan: AbsorbPlan
): string {
  const guardFile = path.join(directory, 'guard.json');
  fs.writeFileSync(
    guardFile,
    JSON.stringify({
      owner: 'anthracite-absorb',
      root: getAbsorbRoot(),
      active: plan.targets[0].branch,
      participants: plan.replay,
      expected: expected.flatMap((item) => [
        { ref: `refs/heads/${item.name}`, oid: item.revision },
        ...(item.metadata
          ? [
              {
                ref: `refs/branch-metadata/${item.name}`,
                oid: item.metadata,
              },
            ]
          : []),
      ]),
    })
  );
  return guardFile;
}
function publishAbsorbBranch(input: {
  readonly branch: string;
  readonly revision: string;
  readonly expected: readonly Expected[];
  readonly participants: readonly string[];
}): void {
  const { branch, revision, expected, participants } = input;
  withFrozenCommitGuard(
    branch,
    (prefix) => {
      const checks = expected
        .flatMap((item) => [
          `${item.name === branch ? 'update' : 'verify'} refs/heads/${
            item.name
          }\0${item.name === branch ? revision + '\0' : ''}${item.revision}\0`,
          ...(item.metadata
            ? [`verify refs/branch-metadata/${item.name}\0${item.metadata}\0`]
            : []),
        ])
        .join('');
      git([...prefix, 'update-ref', '--stdin', '-z'], {
        input: `start\0${checks}prepare\0commit\0`,
      });
    },
    { participants: participants, allRefs: true }
  );
}

function recordReachedWrites(input: {
  readonly directory: string;
  readonly plan: AbsorbPlan;
  readonly expected: readonly Expected[];
  readonly completed: string[];
}): void {
  const file = path.join(input.directory, 'guard.json');
  if (!fs.existsSync(file)) return;
  try {
    const reached = readAbsorbGuard(file);
    for (const branch of input.plan.replay) {
      const saved = input.expected.find((item) => item.name === branch);
      const actual = reached.expected.find(
        (item) => item.ref === `refs/heads/${branch}`
      );
      if (
        saved &&
        actual &&
        saved.revision !== actual.oid &&
        !input.completed.includes(branch)
      )
        input.completed.push(branch);
    }
  } catch {
    // An unreadable owned record must not hide the retained input location.
  }
}
