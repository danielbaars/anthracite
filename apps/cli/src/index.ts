#!/usr/bin/env node
/* eslint-disable no-console */

import chalk from 'chalk';
import tmp from 'tmp';
import yargs from 'yargs';
import { version } from '../package.json';
import { globalArgumentsOptions } from './lib/global_arguments';
import { getYargsInput } from './lib/pre-yargs/preprocess_command';
import { registerCommands } from './lib/register_commands';
import { registerCompletion } from './commands/completion';

import { commandModules } from './command_modules';

// this line gets rid of warnings about "experimental fetch API" for our users
// while still showing us warnings when we test with DEBUG=1
if (!process.env.DEBUG) {
  process.removeAllListeners('warning');
}

// https://www.npmjs.com/package/tmp#graceful-cleanup
tmp.setGracefulCleanup();

process.on('uncaughtException', (err) => {
  console.error(chalk.redBright(`UNCAUGHT EXCEPTION: ${err.message}`));
  if (process.env.DEBUG) console.error(chalk.redBright(`${err.stack}`));
  // eslint-disable-next-line no-restricted-syntax
  process.exit(1);
});

const cli = registerCompletion(
  registerCommands(yargs(getYargsInput(commandModules)), commandModules),
  commandModules
);

void cli
  // Pin the program name; yargs otherwise derives it from the process, which is
  // the runtime ("bun") in the compiled single-file binary, or "index.js" under
  // node.
  .scriptName('an')
  .help()
  // Pin to the bundled version; yargs' default resolves package.json relative
  // to the cwd, which is wrong in the single-file binary / outside apps/cli.
  .version(version)
  .usage(
    'Anthracite is a command line tool that makes working with stacked changes fast & intuitive.\n\nRun an <command> --help for command-specific options.'
  )
  .options(globalArgumentsOptions)
  .global(Object.keys(globalArgumentsOptions))
  .strict()
  // Avoid yargs' blank automatic-help error line on the native runtime.
  .showHelpOnFail(false)
  .demandCommand().argv;
