import yargs, { Arguments, CommandModule, Options } from 'yargs';

import { version } from '../../../package.json';
import { globalArgumentsOptions } from '../global_arguments';
import { registerCommands } from '../register_commands';

import { GIT_COMMAND_ALLOWLIST } from './passthrough';

export class InteractionArgumentError extends Error {}

/** Ask the registered grammar which suspicious tokens are actual options. */
export function validateInteractionArguments(
  args: readonly string[],
  commands: readonly CommandModule[]
): void {
  if (GIT_COMMAND_ALLOWLIST.includes(args[0])) return;
  const end = args.indexOf('--');
  const candidates = args
    .slice(0, end === -1 ? args.length : end)
    .map((argument, index) => ({ argument, index }))
    .filter(({ argument }) => isInvalidPolicyToken(argument));
  if (!candidates.length) return;

  let prefix = '__charcoal_interaction_probe_';
  while (args.some((argument) => argument.includes(prefix))) prefix += '_';
  const probeArgs = [...args];
  const options: Record<string, Options> = {};
  for (const { index } of candidates) {
    const key = `${prefix}${index}`;
    options[key] = { type: 'boolean' };
    probeArgs[index] = `--${key}=true`;
  }
  let parsed: Arguments | undefined;
  const executionBlocked = new Error(
    'Policy preflight cannot execute commands.'
  );
  try {
    // Keep command arities/aliases instead of scanning inside string values.
    registerCommands(yargs(probeArgs), commands)
      .help()
      .version(version)
      .options(globalArgumentsOptions)
      .options(options)
      .global([...Object.keys(globalArgumentsOptions), ...Object.keys(options)])
      .showHelpOnFail(false)
      .middleware((argv) => {
        parsed = argv;
        throw executionBlocked;
      }, true)
      .parseSync(probeArgs, {}, (_error, argv) => {
        parsed = argv;
      });
  } catch (error) {
    if (error !== executionBlocked) throw error;
  }
  for (const { argument, index } of candidates) {
    if (Object.prototype.hasOwnProperty.call(parsed, `${prefix}${index}`))
      throw new InteractionArgumentError(
        `Invalid policy option ${
          argument.split('=')[0]
        }: use a boolean true or false without properties.`
      );
  }
}

function isInvalidPolicyToken(argument: string): boolean {
  const long = /^--(?:no-)?(?:quiet|interactive|q)(.*)$/.exec(argument);
  if (long) {
    const suffix = long[1];
    return (
      suffix.startsWith('.') ||
      suffix.startsWith('[') ||
      (suffix.startsWith('=') && !/^=(?:true|false)$/.test(suffix))
    );
  }
  // With '=' yargs consumes a short token's remainder as its first option value.
  return /^-q[^-]*=/.test(argument) && !/^-q=(?:true|false)$/.test(argument);
}
