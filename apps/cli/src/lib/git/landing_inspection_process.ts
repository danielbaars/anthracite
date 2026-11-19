import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gitEnvironmentOverrides } from './environment_overrides';
import { runGitCommand } from './runner';

export type InspectionGitResult = {
  readonly code: number | null;
  readonly stdout: string;
};
type CommandOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowFailure?: boolean;
};
let activeInspections = 0;
export const landingInspectionIsRunning = (): boolean => activeInspections > 0;

type Execution = {
  readonly deadline: number;
  cancelled: boolean;
  terminate?: () => void;
};
async function runBoundedInspectionProcess(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly executable?: 'git' | 'gh';
    readonly execution: Execution;
    readonly allowFailure?: boolean;
  }
): Promise<InspectionGitResult> {
  const execution = options.execution;
  const budget = Math.min(30000, execution.deadline - Date.now());
  if (execution.cancelled || budget <= 0)
    throw new Error('Replay inspection was interrupted or timed out.');
  const result = await new Promise<InspectionGitResult>((resolve, reject) => {
    const child = spawn(options.executable ?? 'git', args, {
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
      reject(
        new Error('Replay inspection could not start its required process.')
      );
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, 0);
            kill('SIGKILL');
          }
        } catch {
          /* The owned group has already drained. */
        }
      }
      execution.terminate = undefined;
      if (execution.cancelled || timedOut || signal !== null || code === null)
        reject(
          new Error('Replay inspection was interrupted or exceeded its bounds.')
        );
      else resolve({ code, stdout: Buffer.concat(output).toString() });
    });
  });
  if (!options.allowFailure && result.code !== 0)
    throw new Error('Replay inspection could not complete a required process.');
  return result;
}

function simulationEnvironment(original: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...original };
  for (const key of Object.keys(env))
    if (
      key === 'GIT_CONFIG_PARAMETERS' ||
      key === 'GIT_CONFIG_COUNT' ||
      key === 'GIT_EXTERNAL_DIFF' ||
      key === 'GIT_DIFF_OPTS' ||
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
    GIT_EDITOR: 'false',
    GIT_SEQUENCE_EDITOR: 'false',
  };
}

export type LandingInspection = {
  readonly temporary: string;
  readonly hooks: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly originalEnvironment: NodeJS.ProcessEnv;
  readonly run: (
    args: readonly string[],
    options?: CommandOptions
  ) => Promise<InspectionGitResult>;
  readonly read: (args: readonly string[], cwd?: string) => Promise<string>;
  readonly runGithub: (args: readonly string[]) => Promise<string>;
};

/** Own only disposable inspection resources and literal child process groups. */
export async function withLandingInspection<T>(
  prefix: string,
  inspect: (git: LandingInspection) => Promise<T>
): Promise<T> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  activeInspections++;
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
  for (const key of Object.keys(originalEnvironment))
    if (key.startsWith('GIT_TRACE')) delete originalEnvironment[key];
  const environment = simulationEnvironment(originalEnvironment);
  const hooks = path.join(temporary, 'empty-hooks');
  fs.mkdirSync(hooks);
  const run = (
    args: readonly string[],
    options: CommandOptions = {}
  ): Promise<InspectionGitResult> =>
    runBoundedInspectionProcess(
      [
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'maintenance.auto=false',
        '-c',
        'gc.auto=0',
        '-c',
        'fetch.recurseSubmodules=false',
        ...args,
      ],
      {
        cwd: options.cwd ?? temporary,
        env: options.env ?? environment,
        execution,
        allowFailure: options.allowFailure,
      }
    );
  try {
    return await inspect({
      temporary,
      hooks,
      environment,
      originalEnvironment,
      run,
      runGithub: async (args) =>
        (
          await runBoundedInspectionProcess(args, {
            executable: 'gh',
            cwd: process.cwd(),
            env: {
              ...originalEnvironment,
              GH_HOST: 'github.com',
              GH_PROMPT_DISABLED: '1',
              GH_PAGER: '',
              PAGER: '',
            },
            execution,
          })
        ).stdout,
      read: async (args, cwd) => (await run(args, { cwd })).stdout.trim(),
    });
  } finally {
    execution.terminate?.();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
    } finally {
      activeInspections--;
    }
  }
}

/** Preserve source-local transport authentication only; never copy replay execution settings. */
export async function landingTransportArgs(
  git: Pick<LandingInspection, 'run' | 'originalEnvironment'>,
  source: string
): Promise<string[]> {
  const configured = await git.run(
    [
      'config',
      '--null',
      '--get-regexp',
      '^(credential\\.|http\\.|core\\.sshcommand$|ssh\\.variant$)',
    ],
    { cwd: source, env: git.originalEnvironment, allowFailure: true }
  );
  if (configured.code !== 0 && configured.code !== 1)
    throw new Error(
      'Landing inspection could not read transport configuration.'
    );
  return configured.stdout
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf('\n');
      if (separator < 0)
        throw new Error(
          'Landing inspection received invalid transport configuration.'
        );
      return [
        '-c',
        `${entry.slice(0, separator)}=${entry.slice(separator + 1)}`,
      ];
    });
}

/** Status may otherwise execute project fsmonitor and clean/process filter commands. */
export function landingSourceReadArgs(args: readonly string[]): string[] {
  const prefix = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hooksPath=/dev/null',
  ];
  if (args[0] === 'status') {
    const keys = runGitCommand({
      args: [
        ...prefix,
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(clean|smudge|process)$',
      ],
      onError: 'ignore',
      resource: 'landingSafeStatusConfiguration',
      options: {
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_NO_LAZY_FETCH: '1',
        },
        timeout: 5000,
      },
    });
    for (const key of keys.split('\0').filter(Boolean))
      prefix.push(
        '-c',
        `${key}=`,
        '-c',
        `${key.replace(/\.(?:clean|smudge|process)$/, '.required')}=false`
      );
  }
  return [...prefix, ...args];
}

/** Branch-dependent includes change during replay and cannot be flattened safely. */
export async function assertNoBranchConditionalLandingConfiguration(
  git: Pick<LandingInspection, 'run' | 'originalEnvironment'>,
  source: string
): Promise<void> {
  const result = await git.run(
    landingSourceReadArgs([
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^includeif\\..*\\.path$',
    ]),
    { cwd: source, env: git.originalEnvironment, allowFailure: true }
  );
  if (result.code !== 0 && result.code !== 1)
    throw new Error(
      'Replay inspection could not read conditional configuration.'
    );
  if (
    result.stdout
      .split('\0')
      .some((key) => key.toLowerCase().startsWith('includeif.onbranch:'))
  )
    throw new Error(
      'Replay inspection cannot safely reproduce checkout-dependent includeIf.onbranch configuration; make replay configuration independent of the checked-out branch, then preview again. No landing effects were started.'
    );
}

/** Plumbing reads attributes without applying executable transformations to local files. */
export async function assertSafeLandingSourceAttributes(): Promise<void> {
  await withLandingInspection('an-land-source-', async (git) => {
    await assertNoBranchConditionalLandingConfiguration(git, process.cwd());
    const read = async (args: readonly string[]): Promise<string> =>
      (
        await git.run(landingSourceReadArgs(args), {
          cwd: process.cwd(),
          env: {
            ...git.originalEnvironment,
            GIT_OPTIONAL_LOCKS: '0',
            GIT_NO_LAZY_FETCH: '1',
          },
        })
      ).stdout;
    if (
      ['GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE'].some(
        (key) => git.originalEnvironment[key] !== undefined
      )
    )
      throw new Error(
        'Replay inspection cannot safely reproduce overridden history sources.'
      );
    for (const name of ['info/grafts', 'shallow']) {
      const file = (
        await read(['rev-parse', '--path-format=absolute', '--git-path', name])
      ).trim();
      if (
        fs.existsSync(file) &&
        (!fs.statSync(file).isFile() || fs.statSync(file).size !== 0)
      )
        throw new Error(
          'Replay inspection cannot safely reproduce shallow or grafted history.'
        );
    }
    const files = (await read(['ls-files', '--cached', '-z']))
      .split('\0')
      .filter(Boolean);
    for (let offset = 0; offset < files.length; offset += 200) {
      const values = (
        await read([
          'check-attr',
          '--all',
          '-z',
          '--',
          ...files.slice(offset, offset + 200),
        ])
      ).split('\0');
      for (let index = 0; index + 2 < values.length; index += 3)
        if (
          values[index + 1] === 'filter' &&
          !['unset', 'unspecified'].includes(values[index + 2])
        )
          throw new Error(
            'Landing replay inspection cannot safely reproduce active filter attributes; no project filter was executed.'
          );
    }
  });
}
