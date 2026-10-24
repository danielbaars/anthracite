import yargs, { CommandModule } from 'yargs';

import { version } from '../../../package.json';
import { globalArgumentsOptions } from '../global_arguments';
import { registerCommands } from '../register_commands';

import { GIT_COMMAND_ALLOWLIST } from './passthrough';

/** Normalize once so yargs and command-specific argv validation agree. */
export function selectWorkingDirectory(
  commands: readonly CommandModule[]
): string[] {
  const args = process.argv.slice(2);
  const retained: string[] = [];
  let directory: string | undefined;
  let isGitPassthrough = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    // Only a direct cwd prefix may precede raw Git routing. The entire tail,
    // including cwd-looking arguments and terminators, belongs to Git.
    if (retained.length === 0 && GIT_COMMAND_ALLOWLIST.includes(argument)) {
      retained.push(...args.slice(index));
      isGitPassthrough = true;
      break;
    }
    if (argument === '--') {
      retained.push(...args.slice(index));
      break;
    }
    if (argument === '--no-cwd' || argument.startsWith('--no-cwd='))
      throw new CwdSelectionError('--cwd cannot be negated.');
    if (argument === '--cwd') {
      if (directory !== undefined)
        throw new CwdSelectionError('--cwd may only be supplied once.');
      const value = args[++index];
      if (value === undefined || value === '' || value.startsWith('-'))
        throw new CwdSelectionError('--cwd requires a nonempty directory.');
      directory = value;
    } else if (argument.startsWith('--cwd=')) {
      if (directory !== undefined)
        throw new CwdSelectionError('--cwd may only be supplied once.');
      directory = argument.slice('--cwd='.length);
      if (directory === '')
        throw new CwdSelectionError('--cwd requires a nonempty directory.');
    } else retained.push(argument);
  }
  if (
    directory !== undefined &&
    (isGitPassthrough || !isDocumentationRequest(retained, commands))
  ) {
    try {
      process.chdir(directory);
    } catch (error) {
      throw new CwdSelectionError(
        `Cannot use --cwd directory ${JSON.stringify(directory)}: ${
          error instanceof Error ? error.message : 'directory is inaccessible'
        }`
      );
    }
  }
  return retained;
}

export class CwdSelectionError extends Error {}

function isDocumentationRequest(
  args: readonly string[],
  commands: readonly CommandModule[]
): boolean {
  const terminator = args.indexOf('--');
  const options = terminator === -1 ? args : args.slice(0, terminator);
  // Completion has its own early execution path, before ordinary middleware.
  if (
    options.some(
      (arg) =>
        /^--get-yargs-completions(?:\.|=|$)/.test(arg) ||
        /^--no-get-yargs-completions(?:\.[^=]*)?$/.test(arg)
    )
  )
    return false;
  let requested = false;
  const executionBlocked = new Error(
    'Documentation preflight cannot execute commands.'
  );
  try {
    // Reuse real option arities and boolean overrides; this guard stops handlers,
    // while root documentation can still run middleware after rendering output.
    registerCommands(yargs(args), commands)
      .scriptName('ch')
      .help()
      .version(version)
      .options(globalArgumentsOptions)
      .global(Object.keys(globalArgumentsOptions))
      .strict()
      .demandCommand()
      .showHelpOnFail(false)
      .parserConfiguration({ 'populate--': true })
      .middleware((argv) => {
        if (argv.help || argv.version) return;
        if (
          commands.some((module) => {
            const names =
              typeof module.command === 'string'
                ? [module.command]
                : module.command ?? [];
            const aliases =
              typeof module.aliases === 'string'
                ? [module.aliases]
                : module.aliases ?? [];
            return [...names, ...aliases].some(
              (name) => name.split(/\s/)[0] === argv._[0]
            );
          })
        )
          throw executionBlocked;
      })
      .parseSync(args, {}, (error, argv, output) => {
        requested = !error && argv._[0] !== 'completion' && output.length > 0;
      });
  } catch (error) {
    if (error !== executionBlocked) throw error;
  }
  return requested;
}
