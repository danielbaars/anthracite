import { CommandModule } from 'yargs';

/** Normalize once so yargs and command-specific argv validation agree. */
export function selectWorkingDirectory(
  commands: readonly CommandModule[]
): string[] {
  const args = process.argv.slice(2);
  const retained: string[] = [];
  let directory: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
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
  if (directory !== undefined && !isDocumentationRequest(retained, commands)) {
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
  if (!args.some((arg) => arg === '--help' || arg === '--version'))
    return false;
  const command = args.find(
    (arg) => !arg.startsWith('-') && arg !== 'true' && arg !== 'false'
  );
  if (command === undefined) return true;
  return commands.some((module) => {
    const names =
      typeof module.command === 'string' ? [module.command] : module.command;
    const aliases =
      typeof module.aliases === 'string'
        ? [module.aliases]
        : module.aliases ?? [];
    return [...(names ?? []), ...aliases].some(
      (name) => name.split(/\s/)[0] === command
    );
  });
}
