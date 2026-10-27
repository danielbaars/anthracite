import yargs from 'yargs';
import { graphite } from '../../lib/runner';
import { builder as logOptions } from './default';

const ignored = 'Accepted for compatibility; ignored in long mode.';
const args = {
  classic: { ...logOptions.classic, describe: ignored },
  reverse: { ...logOptions.reverse, describe: ignored },
  stack: { ...logOptions.stack, describe: ignored },
  steps: { ...logOptions.steps, describe: ignored },
  'show-untracked': { ...logOptions['show-untracked'], describe: ignored },
  all: { global: false, type: 'boolean', alias: 'a', describe: ignored },
} as const;

export const command = 'long';
export const description =
  'Display a graph of the commit ancestry of all branches.';
export const builder = args;
export const aliases = ['l'];
export const canonical = 'log long';

type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;
export const handler = async (argv: argsT): Promise<void> =>
  graphite(argv, canonical, async (context) => context.engine.logLong());
