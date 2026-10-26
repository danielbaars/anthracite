import fs from 'fs';
import { spawnSync } from 'child_process';
import yargs from 'yargs';
import { assertBranchEditable } from '../lib/engine/frozen_branch';

export const command =
  'internal-push-guard <branch> <originalHook> <remote> <url>';
export const description = false;
export const describe = false;
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .positional('branch', { type: 'string', demandOption: true })
    .positional('originalHook', { type: 'string', demandOption: true })
    .positional('remote', { type: 'string', demandOption: true })
    .positional('url', { type: 'string', demandOption: true });

// Git invokes this scoped guard before sending any branch refs to the remote.
export const handler = (
  args: yargs.Arguments<{
    readonly branch: string;
    readonly originalHook: string;
    readonly remote: string;
    readonly url: string;
  }>
): void => {
  const input = fs.readFileSync(0);
  let executable = false;
  try {
    fs.accessSync(args.originalHook, fs.constants.X_OK);
    executable = true;
  } catch {
    /* Missing and non-executable hooks do not run. */
  }
  if (executable) {
    const result = spawnSync(args.originalHook, [args.remote, args.url], {
      input,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
  try {
    assertBranchEditable(args.branch);
  } catch (error: unknown) {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
};
