import fs from 'fs';
import path from 'path';

import { z } from 'zod';

import { executeChild, ExecutionOptions } from './execute_child';

import { commandModules } from '../../command_modules';
import {
  scanWorkingDirectory,
  inspectCommandArguments,
} from '../pre-yargs/select_working_directory';

export const executionInputSchema = z
  .object({
    args: z.array(z.string().refine((value) => !value.includes('\0'))).min(1),
    cwd: z
      .string()
      .refine((value) => !value.includes('\0') && path.isAbsolute(value)),
    why: z
      .string()
      .refine((value) => value.trim().length > 0 && !value.includes('\0')),
  })
  .strict();

export type ExecutionResult = {
  readonly status:
    | 'success'
    | 'cli_error'
    | 'invalid_input'
    | 'spawn_error'
    | 'timeout'
    | 'output_limit';
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly truncated: boolean;
  readonly message?: string;
};

export function createCommandExecutor(options: ExecutionOptions): {
  readonly execute: (
    input: unknown,
    signal: AbortSignal
  ) => Promise<ExecutionResult>;
  readonly shutdown: () => Promise<void>;
} {
  type Entry = {
    readonly input: unknown;
    readonly signal: AbortSignal;
    readonly resolve: (result: ExecutionResult) => void;
    readonly reject: (error: unknown) => void;
    readonly cancel: () => void;
  };
  const queue: Entry[] = [];
  const closing = new AbortController();
  let active: Promise<void> | undefined;
  async function runQueue(): Promise<void> {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) break;
      entry.signal.removeEventListener('abort', entry.cancel);
      try {
        entry.signal.throwIfAborted();
        entry.resolve(await executeCommand(entry.input, options, entry.signal));
      } catch (error: unknown) {
        entry.reject(error);
      }
    }
    active = undefined;
  }
  return {
    execute: async (input, requestSignal) => {
      const signal = AbortSignal.any([requestSignal, closing.signal]);
      signal.throwIfAborted();
      return await new Promise<ExecutionResult>((resolve, reject) => {
        const entry: Entry = {
          input,
          signal,
          resolve,
          reject,
          cancel: () => {
            const index = queue.indexOf(entry);
            if (index !== -1) queue.splice(index, 1);
            reject(signal.reason);
          },
        };
        signal.addEventListener('abort', entry.cancel, { once: true });
        queue.push(entry);
        if (!active) active = runQueue();
      });
    },
    shutdown: async () => {
      closing.abort(
        new Error(
          'MCP connection closed; inspect actual repository state before retrying.'
        )
      );
      await active;
    },
  };
}

export async function executeCommand(
  input: unknown,
  options: ExecutionOptions,
  signal: AbortSignal
): Promise<ExecutionResult> {
  const parsed = executionInputSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      'invalid_input',
      'Supply exactly args (a nonempty string array), an absolute directory cwd and a nonempty why, without NUL characters.'
    );
  const { args, cwd } = parsed.data;
  try {
    if (!fs.statSync(cwd).isDirectory()) throw new Error('not a directory');
    fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
    const selected = scanWorkingDirectory(args);
    if (
      selected.directory !== undefined &&
      fs.realpathSync(path.resolve(cwd, selected.directory)) !==
        fs.realpathSync(cwd)
    )
      throw new Error('CLI --cwd must identify the same directory as tool cwd');
    if (!selected.isGitPassthrough) {
      const command = inspectCommandArguments(selected.args, commandModules);
      if (command.command === 'mcp' && !command.isDocumentation)
        throw new Error(
          'Recursive MCP server startup is not allowed; use mcp --help for documentation'
        );
    }
  } catch (error) {
    return failure(
      'invalid_input',
      `Cannot use cwd ${JSON.stringify(cwd)}: ${
        error instanceof Error ? error.message : 'directory is inaccessible'
      }`
    );
  }
  return await executeChild({ args, cwd }, options, signal);
}

function failure(
  status: 'invalid_input' | 'spawn_error',
  message: string
): ExecutionResult {
  return {
    status,
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    truncated: false,
    message,
  };
}
