import { Argv, Options } from 'yargs';
import { registerCommands } from '../lib/register_commands';
import * as logDefault from './log-commands/default';
import * as logLong from './log-commands/long';
import * as logShort from './log-commands/short';

export const command = 'log <command>';
export const desc = 'Commands that log your stacks.';
export const aliases = ['l'];
export const builder = function (yargs: Argv): Argv {
  // The group supplies completion before a leaf is selected. Leaf commands
  // own their aliases so help does not register each short form twice.
  const groupOptions: Record<string, Options> = {};
  for (const [name, option] of Object.entries(logDefault.builder))
    groupOptions[name] = { ...option, alias: [] };
  return registerCommands(yargs.options(groupOptions), [
    logDefault,
    logLong,
    logShort,
  ]).strict();
};
