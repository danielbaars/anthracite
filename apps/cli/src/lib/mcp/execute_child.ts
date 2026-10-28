import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { StringDecoder } from 'string_decoder';

import { z } from 'zod';

import { ExecutionResult } from './execute';
import { getSelfCliCommand } from '../utils/self_cli_command';

export type ExecutionOptions = {
  readonly commandTimeoutMs: number;
  readonly maxOutputBytes: number;
};

/** Own one CLI process group until its child is reaped and captured pipes close. */
// eslint-disable-next-line max-lines-per-function
export async function executeChild(
  input: { readonly args: readonly string[]; readonly cwd: string },
  options: ExecutionOptions,
  requestSignal: AbortSignal
): Promise<ExecutionResult> {
  requestSignal.throwIfAborted();
  const [executable, ...args] = getSelfCliCommand(input.args);
  const child = spawn(executable, args, {
    cwd: input.cwd,
    env: { ...process.env, GRAPHITE_INTERACTIVE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    shell: false,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let captured = 0;
  let truncated = false;
  let stopReason: 'timeout' | 'output_limit' | undefined;
  let launchError: string | undefined;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let exited = false;
  let closed = false;
  let interrupting = false;
  let escalation: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout | undefined;
  child.once('spawn', () => {
    deadline = setTimeout(() => stop('timeout'), options.commandTimeoutMs);
  });
  const sendSignal = (value: NodeJS.Signals): void => {
    if (child.pid !== undefined) signalGroup(child.pid, value);
  };
  function stop(reason?: 'timeout' | 'output_limit'): void {
    stopReason ??= reason;
    if (interrupting) return;
    interrupting = true;
    sendSignal('SIGINT');
    escalation = setTimeout(() => sendSignal('SIGKILL'), 2000);
    startWatchdog();
  }
  function startWatchdog(): void {
    watchdog ??= setTimeout(() => {
      failCleanup();
    }, 6000);
  }
  function capture(destination: Buffer[], chunk: Buffer): void {
    const remaining = options.maxOutputBytes - captured;
    const retained =
      chunk.length <= remaining
        ? chunk
        : Buffer.from(chunk.subarray(0, remaining));
    if (retained.length) destination.push(retained);
    captured += retained.length;
    if (chunk.length > remaining) {
      truncated = true;
      stop('output_limit');
    }
  }
  child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
  child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
  child.once('error', (error) => {
    launchError = error.message;
    exited = true;
  });
  child.once('exit', (code, terminationSignal) => {
    exitCode = code;
    signal = terminationSignal;
    exited = true;
    clearTimeout(deadline);
    startWatchdog();
    // The root may exit before an ordinary hook descendant closes its pipes.
    if (child.pid !== undefined && groupExists(child.pid)) stop();
  });
  child.once('close', () => {
    closed = true;
  });
  const cancel = (): void => stop();
  requestSignal.addEventListener('abort', cancel, { once: true });
  if (requestSignal.aborted) cancel();
  try {
    while (
      !exited ||
      !closed ||
      (child.pid !== undefined && (await groupIsRunning(child.pid)))
    )
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    if (interrupting && child.pid !== undefined)
      await releaseOwnedCacheLock(input.cwd, child.pid);
    const decode = (chunks: Buffer[]): string => {
      const bytes = Buffer.concat(chunks);
      return truncated
        ? new StringDecoder('utf8').write(bytes)
        : bytes.toString('utf8');
    };
    return {
      status:
        stopReason ??
        (launchError
          ? 'spawn_error'
          : exitCode === 0 && signal === null
          ? 'success'
          : 'cli_error'),
      stdout: decode(stdout),
      stderr: decode(stderr),
      exitCode,
      signal,
      truncated,
      ...(stopReason
        ? {
            message: `${
              stopReason === 'timeout'
                ? `Command exceeded ${options.commandTimeoutMs}ms`
                : `Combined output exceeded ${options.maxOutputBytes} bytes`
            }; owned work stopped. Inspect repository state before retrying; interruption does not roll back changes.`,
          }
        : {}),
      ...(launchError
        ? { message: `Cannot launch Anthracite: ${launchError}` }
        : {}),
    };
  } catch (error: unknown) {
    failCleanup(error);
  } finally {
    requestSignal.removeEventListener('abort', cancel);
    clearTimeout(deadline);
    clearTimeout(escalation);
    clearTimeout(watchdog);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}
function groupExists(pid: number): boolean {
  return signalGroup(pid, 0);
}

async function groupIsRunning(pid: number): Promise<boolean> {
  if (!groupExists(pid)) return false;
  // Linux can retain orphan zombies after SIGKILL; those cannot execute work.
  if (process.platform !== 'linux') return true;
  const entries = await fs.readdir('/proc');
  const statuses = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry))
      .map(async (entry) => {
        try {
          return await fs.readFile(`/proc/${entry}/stat`, 'utf8');
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ENOENT' || error.code === 'ESRCH')
          )
            return '';
          throw error;
        }
      })
  );
  return statuses.some((status) => {
    const [state, , group] = status
      .slice(status.lastIndexOf(')') + 2)
      .split(' ');
    return group === String(pid) && state !== 'Z' && state !== 'X';
  });
}

async function releaseOwnedCacheLock(cwd: string, pid: number): Promise<void> {
  const common = await runProbe('git', ['rev-parse', '--git-common-dir'], cwd);
  if (common === undefined) return;
  const lock = path.resolve(
    cwd,
    common.replace(/\r?\n$/, ''),
    '.graphite_cache_lock'
  );
  try {
    const bytes = await fs.readFile(lock, 'utf8');
    const parsed: unknown = JSON.parse(bytes);
    const owner = z.object({ pid: z.literal(pid) }).safeParse(parsed);
    if (owner.success && (await fs.readFile(lock, 'utf8')) === bytes)
      await fs.unlink(lock);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}

/** Even cleanup's Git lookup is bounded and cannot leave an owned probe group. */
async function runProbe(
  command: string,
  args: readonly string[],
  cwd?: string
): Promise<string | undefined> {
  return await new Promise((resolve) => {
    const probe = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const kill = (): void => {
      if (probe.pid !== undefined) signalGroup(probe.pid, 'SIGKILL');
    };
    const deadline = setTimeout(() => {
      failed = true;
      kill();
    }, 1000);
    const watchdog = setTimeout(() => failCleanup(), 6000);
    probe.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 4096) chunks.push(chunk);
      else {
        failed = true;
        kill();
      }
    });
    probe.once('error', () => {
      failed = true;
    });
    probe.once('close', async (code) => {
      try {
        kill();
        while (probe.pid !== undefined && (await groupIsRunning(probe.pid)))
          await new Promise<void>((resume) => setTimeout(resume, 25));
        resolve(
          code === 0 && !failed
            ? Buffer.concat(chunks).toString('utf8')
            : undefined
        );
      } catch (error: unknown) {
        failCleanup(error);
      } finally {
        clearTimeout(deadline);
        clearTimeout(watchdog);
      }
    });
  });
}

function failCleanup(error?: unknown): never {
  process.stderr.write(
    `MCP cleanup failed: owned command group cleanup could not be established; refusing further execution.${
      error instanceof Error ? ` ${error.message}` : ''
    }\n`
  );
  // A stuck owned group must never release the queue to another mutation.
  // eslint-disable-next-line no-restricted-syntax
  process.exit(1);
}
