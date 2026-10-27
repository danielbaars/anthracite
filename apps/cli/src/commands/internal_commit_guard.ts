import fs from 'fs';
import { runGitHook } from '../lib/git/run_hook';
import yargs from 'yargs';
import { assertBranchEditable } from '../lib/engine/frozen_branch';

export const command = 'internal-commit-guard <branch> <originalHook> <phase>';
export const description = false;
export const describe = false;
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .positional('branch', { type: 'string', demandOption: true })
    .positional('originalHook', { type: 'string', demandOption: true })
    .positional('phase', { type: 'string', demandOption: true })
    .option('all-refs', { type: 'boolean', default: false })
    .option('participant', { type: 'string', array: true, nargs: 1 });

// This subprocess intentionally avoids context initialization, locks and repair.
export const handler = (
  args: yargs.Arguments<{
    readonly branch: string;
    readonly originalHook: string;
    readonly phase: string;
    readonly 'all-refs': boolean;
    readonly participant?: string[];
  }>
): void => {
  const input = fs.readFileSync(0);
  let executable = false;
  try {
    fs.accessSync(args.originalHook, fs.constants.X_OK);
    executable = true;
  } catch {
    /* A missing or non-executable hook is not a Git hook. */
  }
  if (executable) {
    const status = runGitHook(args.originalHook, [args.phase], input);
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }
  if (args.phase !== 'prepared' && args.phase !== 'before-mutation') return;
  const changesBranch = input
    .toString('utf8')
    .split('\n')
    .some(
      (line) =>
        line.split(' ')[2] === `refs/heads/${args.branch}` ||
        line.split(' ')[2] === 'HEAD'
    );
  if (!changesBranch && !args['all-refs'] && args.phase !== 'before-mutation')
    return;
  try {
    for (const branch of [args.branch, ...(args.participant ?? [])])
      assertBranchEditable(branch);
  } catch (error: unknown) {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
};
