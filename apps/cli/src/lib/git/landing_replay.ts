import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LandPlan } from '../../actions/land';
import { gitEnvironmentOverrides } from './environment_overrides';

export type LandingReplayAssessment =
  | { readonly status: 'clean' }
  | {
      readonly status: 'conflict';
      readonly branch: string;
      readonly paths: readonly string[];
    }
  | { readonly status: 'unavailable'; readonly reason: string };

type GitResult = { readonly code: number | null; readonly stdout: string };
type CommandOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowFailure?: boolean;
};
type Execution = {
  readonly deadline: number;
  cancelled: boolean;
  terminate?: () => void;
};
type ReplayRepository = {
  readonly source: string;
  readonly directory: string;
  readonly hooks: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly originalEnvironment: NodeJS.ProcessEnv;
  readonly run: (
    args: readonly string[],
    options?: CommandOptions
  ) => Promise<GitResult>;
  readonly read: (args: readonly string[], cwd?: string) => Promise<string>;
};

async function runBoundedGit(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly execution: Execution;
    readonly allowFailure?: boolean;
  }
): Promise<GitResult> {
  const execution = options.execution;
  const budget = Math.min(30000, execution.deadline - Date.now());
  if (execution.cancelled || budget <= 0)
    throw new Error('Replay inspection was interrupted or timed out.');
  const result = await new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // The owned process group may already have exited.
      }
    };
    const stop = (): void => {
      kill('SIGTERM');
      killTimer ??= setTimeout(() => kill('SIGKILL'), 250);
    };
    execution.terminate = stop;
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, budget);
    child.stdout.on('data', (data: Buffer) => {
      size += data.length;
      if (size > 4 * 1024 * 1024) {
        timedOut = true;
        stop();
      } else output.push(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      size += data.length;
      if (size > 4 * 1024 * 1024) {
        timedOut = true;
        stop();
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Replay inspection could not start Git.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
        kill('SIGKILL');
      }
      execution.terminate = undefined;
      if (execution.cancelled || timedOut)
        reject(
          new Error('Replay inspection was interrupted or exceeded its bounds.')
        );
      else resolve({ code, stdout: Buffer.concat(output).toString() });
    });
  });
  if (!options.allowFailure && result.code !== 0)
    throw new Error(
      'Replay inspection could not complete a required Git operation.'
    );
  return result;
}

function simulationEnvironment(original: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...original };
  for (const key of Object.keys(env))
    if (
      key === 'GIT_CONFIG_PARAMETERS' ||
      key === 'GIT_CONFIG_COUNT' ||
      key.startsWith('GIT_CONFIG_KEY_') ||
      key.startsWith('GIT_CONFIG_VALUE_')
    )
      delete env[key];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

async function assertSupportedInputs(
  plan: LandPlan,
  git: ReplayRepository
): Promise<void> {
  assertLandingGraph(plan);
  const unsafe = await git.run(
    [
      'config',
      '--get-regexp',
      '^(merge\\.|filter\\.|rebase\\.|core\\.(attributesfile|autocrlf|eol|safecrlf)|extensions\\.objectformat)',
    ],
    { cwd: git.source, env: git.originalEnvironment, allowFailure: true }
  );
  if (unsafe.code !== 1)
    throw new Error(
      'Replay inspection cannot safely reproduce this replay configuration.'
    );
  if (
    await git.read(
      ['for-each-ref', '--format=%(refname)', 'refs/replace'],
      git.source
    )
  )
    throw new Error(
      'Replay inspection cannot safely reproduce replacement history.'
    );
  const info = await git.read(
    ['rev-parse', '--git-path', 'info/attributes'],
    git.source
  );
  if (fs.existsSync(path.resolve(git.source, info)))
    throw new Error(
      'Replay inspection cannot safely reproduce repository attributes.'
    );
}

async function prepareReplayObjects(
  plan: LandPlan,
  remote: string,
  git: ReplayRepository
): Promise<void> {
  if (!plan.remoteTrunk)
    throw new Error('Remote trunk is unavailable for replay inspection.');
  const objects = await git.read(
    ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
    git.source
  );
  await git.run(['init', '--quiet', '--template=', git.directory], {
    cwd: path.dirname(git.directory),
  });
  fs.writeFileSync(
    path.join(git.directory, '.git', 'objects', 'info', 'alternates'),
    objects + '\n'
  );
  for (const [key, value] of [
    ['user.name', 'Anthracite replay inspection'],
    ['user.email', 'replay@example.invalid'],
    ['core.hooksPath', git.hooks],
    ['core.attributesFile', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['commit.gpgSign', 'false'],
    ['rebase.updateRefs', 'false'],
    ['rerere.enabled', 'false'],
  ])
    await git.run(['config', key, value]);
  if (
    (
      await git.run(['cat-file', '-e', `${plan.remoteTrunk}^{commit}`], {
        allowFailure: true,
      })
    ).code !== 0
  ) {
    const url = (
      await git.run(['remote', 'get-url', remote], {
        cwd: git.source,
        env: git.originalEnvironment,
      })
    ).stdout.trim();
    const fetchEnvironment: NodeJS.ProcessEnv = {
      ...git.originalEnvironment,
      GIT_TERMINAL_PROMPT: '0',
    };
    for (const key of Object.keys(fetchEnvironment))
      if (
        key === 'GIT_CONFIG_PARAMETERS' ||
        key === 'GIT_CONFIG_COUNT' ||
        key.startsWith('GIT_CONFIG_KEY_') ||
        key.startsWith('GIT_CONFIG_VALUE_')
      )
        delete fetchEnvironment[key];
    await git.run(
      [
        '-c',
        `core.hooksPath=${git.hooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'maintenance.auto=false',
        '-c',
        'gc.auto=0',
        '-c',
        'fetch.recurseSubmodules=false',
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        url,
        `refs/heads/${plan.trunk}`,
      ],
      { env: fetchEnvironment }
    );
    await git.run(['cat-file', '-e', `${plan.remoteTrunk}^{commit}`]);
  }
  const commits = new Set<string>([plan.remoteTrunk]);
  for (const member of [...plan.merges, ...plan.maintenance]) {
    commits.add(member.base);
    for (const commit of (
      await git.read(['rev-list', `${member.base}..${member.head}`])
    )
      .split('\n')
      .filter(Boolean))
      commits.add(commit);
  }
  for (const commit of commits) {
    const files = (
      await git.run(['ls-tree', '-r', '--name-only', '-z', commit])
    ).stdout.split('\0');
    if (files.some((file) => path.posix.basename(file) === '.gitattributes'))
      throw new Error(
        'Replay inspection cannot safely reproduce tracked attributes.'
      );
  }
}

async function replayCommits(
  git: ReplayRepository,
  input: {
    readonly branch: string;
    readonly onto: string;
    readonly from: string;
    readonly head: string;
    readonly force: boolean;
  }
): Promise<string | LandingReplayAssessment> {
  await git.run(['checkout', '--quiet', '--detach', input.head]);
  const result = await git.run(
    [
      'rebase',
      ...(input.force ? ['--force-rebase'] : []),
      '--onto',
      input.onto,
      input.from,
    ],
    { allowFailure: true }
  );
  if (result.code === 0) return git.read(['rev-parse', 'HEAD']);
  const paths = (
    await git.run(['diff', '--name-only', '--diff-filter=U', '-z'])
  ).stdout
    .split('\0')
    .filter(Boolean);
  if (paths.length) return { status: 'conflict', branch: input.branch, paths };
  throw new Error('Replay inspection failed without verified conflict paths.');
}

function assertLandingGraph(plan: LandPlan): void {
  const first = plan.merges[0];
  if (!first) throw new Error('Replay merge scope is unavailable.');
  let parent = plan.trunk;
  for (const member of plan.merges) {
    if (member.parent !== parent)
      throw new Error('Replay merge chain changed its captured parent.');
    parent = member.branch;
  }
  const known = new Set([plan.trunk]);
  for (const member of [...plan.merges, ...plan.maintenance]) {
    if (
      known.has(member.branch) ||
      !known.has(member.parent) ||
      (member !== first && member.parent === plan.trunk)
    )
      throw new Error(
        'Replay mandatory participant graph is unavailable or inconsistent.'
      );
    known.add(member.branch);
  }
}

function capturedSurvivors(
  plan: LandPlan,
  position: number
): LandPlan['maintenance'] {
  const current = plan.merges[position];
  if (!current) throw new Error('Replay merge scope is unavailable.');
  const affected = new Set([current.branch]);
  const survivors: LandPlan['merges'][number][] = [];
  for (const member of [
    ...plan.merges.slice(position + 1),
    ...plan.maintenance,
  ]) {
    if (!affected.has(member.parent)) continue;
    affected.add(member.branch);
    survivors.push(member);
  }
  return survivors;
}

async function simulateLandingGraph(
  plan: LandPlan,
  git: ReplayRepository
): Promise<LandingReplayAssessment> {
  if (!plan.remoteTrunk)
    throw new Error('Remote trunk is unavailable for replay inspection.');
  const members = [...plan.merges, ...plan.maintenance];
  const reached = new Map(
    members.map((member) => [
      member.branch,
      { head: member.head, base: member.base, parent: member.parent },
    ])
  );
  for (const member of members) {
    if (
      member.mergedResult &&
      (
        await git.run(
          [
            'merge-base',
            '--is-ancestor',
            member.mergedResult,
            plan.remoteTrunk,
          ],
          { allowFailure: true }
        )
      ).code !== 0
    )
      throw new Error(
        'Replay cleanup-only result is not verified in captured remote trunk.'
      );
  }
  let trunk = plan.remoteTrunk;
  for (const [index, target] of plan.merges.entries()) {
    const current = reached.get(target.branch);
    if (!current) throw new Error('Replay participant is unavailable.');
    if (!target.mergedResult) {
      const merged = await replayCommits(git, {
        branch: target.branch,
        onto: trunk,
        from:
          index === 0 ? target.pr?.baseRefOid ?? current.base : current.base,
        head: current.head,
        force: true,
      });
      if (typeof merged !== 'string') return merged;
      trunk = merged;
    }
    const survivors = capturedSurvivors(plan, index);
    const landedParents = new Set([
      target.branch,
      ...survivors
        .filter((member) => member.mergedResult)
        .map((member) => member.branch),
    ]);
    for (const member of survivors) {
      const next = reached.get(member.branch);
      if (!next) throw new Error('Replay participant is unavailable.');
      if (landedParents.has(next.parent)) next.parent = plan.trunk;
    }
    for (const member of survivors) {
      if (member.mergedResult) continue;
      const next = reached.get(member.branch);
      if (!next) throw new Error('Replay participant is unavailable.');
      const onto =
        next.parent === plan.trunk ? trunk : reached.get(next.parent)?.head;
      if (!onto) throw new Error('Replay parent is unavailable.');
      if (next.base === onto) continue;
      const value = await replayCommits(git, {
        branch: member.branch,
        onto,
        from: next.base,
        head: next.head,
        force: false,
      });
      if (typeof value !== 'string') return value;
      next.head = value;
      next.base = onto;
    }
  }
  return { status: 'clean' };
}

/** Simulate only in owned disposable storage; generated OIDs never authorize effects. */
export async function inspectLandingReplay(
  plan: LandPlan,
  remote: string
): Promise<LandingReplayAssessment> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'an-land-replay-'));
  const execution: Execution = {
    deadline: Date.now() + 60000,
    cancelled: false,
  };
  const cancel = (): void => {
    execution.cancelled = true;
    execution.terminate?.();
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const originalEnvironment = { ...process.env };
  for (const key of gitEnvironmentOverrides) delete originalEnvironment[key];
  const environment = simulationEnvironment(originalEnvironment);
  const directory = path.join(temporary, 'replay');
  const hooks = path.join(temporary, 'empty-hooks');
  fs.mkdirSync(hooks);
  const git: ReplayRepository = {
    source: process.cwd(),
    directory,
    hooks,
    environment,
    originalEnvironment,
    run: (args, options = {}) =>
      runBoundedGit(args, {
        cwd: options.cwd ?? directory,
        env: options.env ?? environment,
        execution,
        allowFailure: options.allowFailure,
      }),
    read: async (args, cwd = directory) =>
      (await git.run(args, { cwd })).stdout.trim(),
  };
  try {
    await assertSupportedInputs(plan, git);
    await prepareReplayObjects(plan, remote, git);
    return await simulateLandingGraph(plan, git);
  } catch (error: unknown) {
    return {
      status: 'unavailable',
      reason:
        error instanceof Error
          ? error.message
          : 'Replay inspection is unavailable.',
    };
  } finally {
    execution.terminate?.();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
