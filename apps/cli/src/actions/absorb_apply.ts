import fs from 'fs';
import { persistContinuation, clearContinuation } from './persist_continuation';
import {
  assertAbsorbContinuationAvailable,
  readAbsorbExecution,
} from './absorb_recovery';
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
import {
  getMetadataRefList,
  readMetadataRef,
} from '../lib/engine/metadata_ref';
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
  readRetainedAbsorbInput,
  retainAbsorbRestorationBase,
  AbsorbInput,
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

/** Apply immutable original corrections and replay their full tracked closure. */
// eslint-disable-next-line max-params
export function applyAbsorb(
  plan: AbsorbPlan,
  context: TContext,
  noVerify: boolean,
  publishInput?: () => void
): void {
  if (!plan.targets.length) {
    publishInput?.();
    if (!context.quiet) {
      for (const item of plan.leftovers)
        process.stdout.write(`Retained ${item.path}: ${item.reason}\n`);
      process.stdout.write('No eligible staged corrections to absorb.\n');
    }
    return;
  }
  const names = [
    ...new Set([
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
  const ranges = plan.replay.map((name) => {
    const base = context.engine.getBaseRevision(name);
    const originalTip = context.engine.getRevision(name);
    return {
      name,
      parent: context.engine.getParentPrecondition(name),
      metadata: readMetadataRef(name),
      base,
      originalTip,
      commits: git(['rev-list', '--reverse', `${base}..${originalTip}`])
        .split('\n')
        .filter(Boolean),
    };
  });
  const amendedTrees = new Map(
    [...new Set(plan.targets.map((target) => target.commit))].map((commit) => [
      commit,
      prepareAbsorbTree(
        plan.targets.filter((target) => target.commit === commit)
      ),
    ])
  );
  assertAbsorbApplicationAvailable(plan, context);
  const lock = getCacheLock();
  lock.lock();
  try {
    assertExpected(expected, plan.replay);
    publishInput?.();
    executeAbsorb({
      plan,
      context,
      noVerify,
      expected,
      ranges,
      amendedTrees,
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

/** Known blockers shared by strict preview and application, before staging writes. */
export function assertAbsorbApplicationAvailable(
  plan: AbsorbPlan,
  context: TContext
): void {
  if (!plan.targets.length) return;
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
  assertRestackFilesAvailable({
    branches: plan.replay.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    checkoutRevisions: plan.replay.map((name) =>
      context.engine.getBaseRevision(name)
    ),
    skipTrackedPaths: true,
    operation: 'absorb',
  });
  assertBranchesAvailableInWorktrees([...plan.replay]);
  for (const name of plan.replay) assertBranchEditable(name);
}

type AbsorbExecution = {
  readonly plan: AbsorbPlan;
  readonly context: TContext;
  readonly noVerify: boolean;
  readonly expected: readonly Expected[];
  readonly ranges: readonly {
    readonly name: string;
    readonly parent: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly base: string;
    readonly originalTip: string;
    readonly commits: readonly string[];
  }[];
  readonly amendedTrees: ReadonlyMap<string, string>;
};
// eslint-disable-next-line max-lines-per-function
function executeAbsorb(
  execution: AbsorbExecution,
  resumed?: {
    readonly input: AbsorbInput;
    readonly completed: readonly string[];
  }
): void {
  const { plan, context, noVerify, expected, ranges, amendedTrees } = execution;
  const input = resumed?.input ?? retainAbsorbInput(plan.source);
  const completed: string[] = [...(resumed?.completed ?? [])];
  if (!resumed) {
    const originalHead = git(['rev-parse', 'HEAD']);
    const nominalTree = prepareAbsorbTree(
      plan.targets.map((target) => ({
        ...target,
        commit: originalHead,
        blob: git(['rev-parse', originalHead + ':' + target.path]),
        hunk: target.sourceHunk,
      }))
    );
    retainAbsorbRestorationBase(
      input,
      nominalTree,
      ranges.map((range) => range.originalTip),
      ranges[0].base
    );
  }

  let active = 'preparing replay';
  if (!resumed)
    fs.writeFileSync(
      path.join(input.directory, 'plan.json'),
      JSON.stringify({ plan, expected, ranges, noVerify })
    );
  const worktree = path.join(input.directory, 'construction');
  try {
    const guardFile = resumed
      ? path.join(input.directory, 'guard.json')
      : createGuard(input.directory, expected, plan);
    // eslint-disable-next-line max-lines-per-function
    withAbsorbGuard(guardFile, () => {
      let isolated = Boolean(resumed);
      for (const range of ranges.filter(
        (item) => !completed.includes(item.name)
      )) {
        const name = range.name;
        const remaining = plan.replay.filter(
          (value) => !completed.includes(value)
        );
        const guard = readAbsorbGuard(guardFile);
        guard.active = name;
        fs.writeFileSync(guardFile, JSON.stringify(guard));
        checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
        for (const participant of remaining) assertBranchEditable(participant);
        const target = plan.targets.find((item) => item.branch === name);
        if (target) {
          active = `constructing ${name}`;
          const revision = prepareAbsorbRange({
            target,
            commits: range.commits,
            base: context.engine.getRevision(range.parent),
            amendedTrees,
            worktree,
            noVerify,
            participants: plan.replay,
          });
          checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
          if (!isolated) assertAbsorbInputUnchanged(input);
          else git(['diff-index', '--quiet', 'HEAD', '--']);
          const checkoutTree = isolated ? git(['write-tree']) : undefined;
          active = `publishing ${name}`;
          const publicationGuard = readAbsorbGuard(guardFile);
          const currentExpected = expected.map((item) => ({
            ...item,
            revision:
              publicationGuard.expected.find(
                (entry) => entry.ref === `refs/heads/${item.name}`
              )?.oid ?? item.revision,
            metadata:
              publicationGuard.expected.find(
                (entry) => entry.ref === `refs/branch-metadata/${item.name}`
              )?.oid ?? item.metadata,
          }));
          const parentRevision = context.engine.getRevision(range.parent);
          publishAbsorbBranch({
            branch: name,
            revision,
            metadataRevision:
              parentRevision === range.base
                ? currentExpected.find((item) => item.name === name)?.metadata
                : git(['hash-object', '-w', '--stdin'], {
                    input: JSON.stringify({
                      ...range.metadata,
                      parentBranchRevision: parentRevision,
                    }),
                  }),
            expected: currentExpected,
            participants: plan.replay,
          });
          completed.push(name);
          saveAbsorbProgress(input.directory, completed, context);
          checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
          context.engine.rebuild();
          // Isolate the caller's retained input exactly once, before real replay.
          if (!isolated) assertAbsorbInputUnchanged(input);
          else if (
            git(['write-tree']) !== checkoutTree ||
            git(['diff-files', '--name-only', '-z'])
          )
            throw new PreconditionsFailedError(
              'Absorb source work changed during publication. Retained input is available; inspect hook effects.'
            );
          git(['read-tree', '--reset', '-u', 'HEAD']);
          isolated = true;
          git(['worktree', 'remove', worktree]);
          continue;
        }
        active = `replaying ${name}`;
        const result = context.engine.restackBranch(name, remaining);
        if (result.result === 'REBASE_CONFLICT') {
          context.continueConfig.update((data) => {
            data.absorb = {
              directory: input.directory,
              source: plan.source,
              mandatory: [...plan.replay],
              completed: [...completed],
            };
          });
          persistContinuation(
            {
              rebasedBranchBase: result.rebasedBranchBase,
              branchesToRestack: remaining.filter((value) => value !== name),
            },
            context
          );
          throw new PreconditionsFailedError(
            readAbsorbGit(['ls-files', '--unmerged']).trim()
              ? 'Content conflict during mandatory replay.'
              : 'Replay stopped; inspect Git state and hooks.'
          );
        }
        completed.push(name);
        saveAbsorbProgress(input.directory, completed, context);
        checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      }
      checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      active = 'restoring retained input';
      git(['switch', '--quiet', plan.source]);
      checkAbsorbGuard(guardFile, 'before-mutation', Buffer.alloc(0));
      restoreAbsorbInput(input);
      if (!context.quiet) {
        for (const item of plan.leftovers)
          process.stdout.write(`Retained ${item.path}: ${item.reason}\n`);
        process.stdout.write(
          `Absorbed ${plan.targets.length} hunk(s) into ${[
            ...new Set(plan.targets.map((target) => target.branch)),
          ].join(', ')}. Completed replay: ${completed.join(
            ', '
          )}. Retained input restored.\n`
        );
      }
      if (context.continueConfig.data.absorb) clearContinuation(context);
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
      }\n${
        context.engine.rebaseInProgress() && context.continueConfig.data.absorb
          ? 'Resolve the active Git replay, stage only its resolutions, then run an continue in this worktree. Original leftovers and unstaged input remain isolated. '
          : 'No automatic continuation is available for this Git state. '
      }Inspect the saved plan/progress and actual refs. Finish or abort the active Git replay deliberately if one exists. Return to ${
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
  readonly metadataRevision: string | undefined;
  readonly expected: readonly Expected[];
  readonly participants: readonly string[];
}): void {
  const { branch, revision, metadataRevision, expected, participants } = input;
  withFrozenCommitGuard(
    branch,
    (prefix) => {
      const checks = expected
        .flatMap((item) => [
          `${item.name === branch ? 'update' : 'verify'} refs/heads/${
            item.name
          }\0${item.name === branch ? revision + '\0' : ''}${item.revision}\0`,
          ...(item.metadata
            ? [
                item.name === branch && metadataRevision
                  ? `update refs/branch-metadata/${item.name}\0${metadataRevision}\0${item.metadata}\0`
                  : `verify refs/branch-metadata/${item.name}\0${item.metadata}\0`,
              ]
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

function saveAbsorbProgress(
  directory: string,
  completed: readonly string[],
  context: TContext
): void {
  fs.writeFileSync(
    path.join(directory, 'progress.json'),
    JSON.stringify({ completed })
  );
  if (context.continueConfig.data.absorb)
    context.continueConfig.update((data) => {
      if (data.absorb) data.absorb.completed = [...completed];
    });
}

/** Resume original immutable ranges; completed target adoption is never repeated. */
export function continueAbsorb(
  opts: { addAll: boolean },
  context: TContext
): void {
  assertAbsorbContinuationAvailable(context.continueConfig.data);
  const role = context.continueConfig.data.absorb;
  const base = context.continueConfig.data.rebasedBranchBase;
  if (!role || !base)
    throw new PreconditionsFailedError('Missing owned absorb continuation.');
  const saved = readAbsorbExecution(role.directory);
  const guardFile = path.join(role.directory, 'guard.json');
  const active = context.engine.getRebaseHead();
  if (!active || role.completed.includes(active))
    throw new PreconditionsFailedError('Invalid active absorb replay.');
  const guard = readAbsorbGuard(guardFile);
  if (guard.active !== active)
    throw new PreconditionsFailedError(
      'Active Git replay differs from saved absorb replay.'
    );
  const lock = getCacheLock();
  lock.lock();
  try {
    if (guard.failure) {
      delete guard.failure;
      fs.writeFileSync(guardFile, JSON.stringify(guard));
    }
    withAbsorbGuard(guardFile, () => {
      if (opts.addAll) context.engine.addAll();
      const result = context.engine.continueRebase(base, role.mandatory);
      if (result.result === 'REBASE_CONFLICT')
        throw new PreconditionsFailedError(
          `Absorb replay remains stopped. Resolve and stage the active replay, then run an continue. Retained input: ${role.directory}.`
        );
      const completed = [...role.completed, result.branchName];
      saveAbsorbProgress(role.directory, completed, context);
      const amendedTrees = new Map(
        [
          ...new Set(
            saved.plan.targets
              .filter((target) => !completed.includes(target.branch))
              .map((target) => target.commit)
          ),
        ].map((commit) => [
          commit,
          prepareAbsorbTree(
            saved.plan.targets.filter((target) => target.commit === commit)
          ),
        ])
      );
      executeAbsorb(
        { ...saved, context, amendedTrees },
        { input: readRetainedAbsorbInput(role.directory), completed }
      );
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Absorb stopped.'))
      throw error;
    const completed = [
      ...(context.continueConfig.data.absorb?.completed ?? role.completed),
    ];
    recordReachedWrites({
      directory: role.directory,
      plan: saved.plan,
      expected: saved.expected,
      completed,
    });
    saveAbsorbProgress(role.directory, completed, context);
    throw new PreconditionsFailedError(
      `Absorb stopped during continuation. Completed: ${
        completed.join(', ') || 'none'
      }. ${error instanceof Error ? error.message : String(error)}\n${
        context.engine.rebaseInProgress()
          ? 'Inspect the active replay; resolve/stage then run an continue.'
          : 'No active rebase remains; inspect reached refs and tracking before further changes.'
      } Retained input: ${role.directory}. Return to ${
        role.source
      } after finishing or aborting any active Git operation. Restore retained input FIRST by running: ${
        process.versions.bun ? 'BUN_BE_BUN=1 ' : ''
      }${shellQuote(process.execPath)} ${shellQuote(
        path.join(role.directory, 'restore.cjs')
      )}. Collision checks preserve newer work. Earlier amendments remain after abort.`
    );
  } finally {
    lock.release();
  }
}
