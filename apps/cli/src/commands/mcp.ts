import yargs from 'yargs';

import { serveMcp } from '../lib/mcp/server';

const options = {
  'command-timeout-ms': {
    type: 'number',
    default: 300000,
    describe:
      'Command deadline in milliseconds (integer 1–3600000; excludes queue time).',
  },
  'max-output-bytes': {
    type: 'number',
    default: 1048576,
    describe:
      'Combined stdout/stderr capture limit (integer 1024–16777216 bytes).',
  },
} as const;

export const command = 'mcp';
export const canonical = 'mcp';
export const description = 'Serve local Anthracite tools over MCP stdio.';
export const builder = (parser: yargs.Argv): yargs.Argv =>
  parser.options(options).check((argv) => {
    for (const [name, minimum, maximum] of [
      ['command-timeout-ms', 1, 3600000],
      ['max-output-bytes', 1024, 16777216],
    ] as const) {
      const value = argv[name];
      if (!Number.isInteger(value) || value < minimum || value > maximum)
        throw new Error(
          `${name} must be an integer from ${minimum} through ${maximum}.`
        );
    }
    return true;
  });
export const handler = async (
  argv: yargs.Arguments<yargs.InferredOptionTypes<typeof options>>
): Promise<void> => {
  await serveMcp({
    commandTimeoutMs: argv['command-timeout-ms'],
    maxOutputBytes: argv['max-output-bytes'],
  });
};
