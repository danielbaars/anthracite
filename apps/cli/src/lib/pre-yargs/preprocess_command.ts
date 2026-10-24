import { CommandModule } from 'yargs';

import { passthrough } from './passthrough';
import {
  CwdSelectionError,
  selectWorkingDirectory,
} from './select_working_directory';

export function getYargsInput(commands: readonly CommandModule[]): string[] {
  try {
    process.argv.splice(
      2,
      process.argv.length - 2,
      ...selectWorkingDirectory(commands)
    );
  } catch (error) {
    if (!(error instanceof CwdSelectionError)) throw error;
    process.stderr.write(`${error.message}\n`);
    // Preflight must stop before yargs, passthrough or command context can run.
    // eslint-disable-next-line no-restricted-syntax
    process.exit(1);
  }
  passthrough(process.argv);
  return process.argv.slice(2);
}
