import yargs, { CommandModule } from 'yargs';

import { version } from '../../../package.json';
import { globalArgumentsOptions } from '../global_arguments';
import { registerCommands } from '../register_commands';

import { GIT_COMMAND_ALLOWLIST } from './passthrough';

/** Normalize once so yargs and command-specific argv validation agree. */
export function selectWorkingDirectory(
  commands: readonly CommandModule[]
): string[] {
  const {
    args: retained,
    directory,
    isGitPassthrough,
  } = scanWorkingDirectory(process.argv.slice(2));
  if (
    directory !== undefined &&
    (isGitPassthrough ||
      !inspectCommandArguments(retained, commands).isDocumentation)
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

/** The CLI and MCP share the literal/raw-Git boundaries without changing server cwd. */
export function scanWorkingDirectory(args: readonly string[]): {
  readonly args: string[];
  readonly directory: string | undefined;
  readonly isGitPassthrough: boolean;
} {
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
    // Yargs dot notation would otherwise accept these as properties of cwd.
    if (/^--(?:no-)?cwd\./.test(argument))
      throw new CwdSelectionError(
        `Unknown argument: ${argument.split('=')[0]}`
      );
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
  return { args: retained, directory, isGitPassthrough };
}

export class CwdSelectionError extends Error {}

export function inspectCommandArguments(
  args: readonly string[],
  commands: readonly CommandModule[]
): { readonly isDocumentation: boolean; readonly command: string | undefined } {
  const terminator = args.indexOf('--');
  const options = terminator === -1 ? args : args.slice(0, terminator);
  // Completion has its own early execution path, before ordinary middleware.
  const hasCompletion = options.some(
    (arg) =>
      /^--get-yargs-completions(?:\.|=|$)/.test(arg) ||
      /^--no-get-yargs-completions(?:\.[^=]*)?$/.test(arg)
  );
  let requested = false;
  let command: string | undefined;
  const executionBlocked = new Error(
    'Documentation preflight cannot execute commands.'
  );
  try {
    // Reuse real option arities and boolean overrides; this guard stops handlers,
    // while root documentation can still run middleware after rendering output.
    registerCommands(yargs(args), commands)
      .scriptName('an')
      .help()
      .version(version)
      .options(globalArgumentsOptions)
      .global(Object.keys(globalArgumentsOptions))
      .strict()
      .demandCommand()
      .showHelpOnFail(false)
      .parserConfiguration({ 'populate--': true })
      .middleware((argv) => {
        command = typeof argv._[0] === 'string' ? argv._[0] : undefined;
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
        command = typeof argv._[0] === 'string' ? argv._[0] : undefined;
        requested =
          !hasCompletion &&
          !error &&
          argv._[0] !== 'completion' &&
          output.length > 0;
      });
  } catch (error) {
    if (error !== executionBlocked) throw error;
  }
  return { isDocumentation: requested, command };
}
