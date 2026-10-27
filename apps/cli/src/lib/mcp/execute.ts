import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { z } from 'zod';

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

// Bun's compiled executable has no filesystem entry point; Node always uses this build.
const executable = process.execPath;
const entryPoint = path.resolve(__dirname, '../../index.js');
const isCompiled =
  !!process.versions.bun && !!process.argv[1]?.startsWith('/$bunfs/');
const prefix = isCompiled ? [] : [entryPoint];

export async function executeCommand(input: unknown): Promise<ExecutionResult> {
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
  return await new Promise<ExecutionResult>((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(executable, [...prefix, ...args], {
      cwd,
      env: { ...process.env, GRAPHITE_INTERACTIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) =>
      resolve(
        failure('spawn_error', `Cannot launch Anthracite: ${error.message}`)
      )
    );
    child.once('close', (exitCode, signal) =>
      resolve({
        status: exitCode === 0 && signal === null ? 'success' : 'cli_error',
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        truncated: false,
      })
    );
  });
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
