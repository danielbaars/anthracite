import yargs from 'yargs';

export const globalArgumentsOptions = {
  cwd: {
    type: 'string',
    description:
      'Working directory. Use a direct --cwd prefix before the Git command for passthroughs; before or after the command for Charcoal commands.',
  },
  interactive: {
    type: 'boolean',
    demandOption: false,
    description:
      'Enable interactive features. Defaults to terminal input and output. Disable with --no-interactive; quiet also disables interaction.',
  },
  quiet: {
    alias: 'q',
    default: false,
    type: 'boolean',
    demandOption: false,
    description: 'Minimize output to the terminal.',
  },
  verify: {
    default: true,
    type: 'boolean',
    demandOption: false,
    description: 'Run git hooks. Disable with --no-verify.',
  },
  debug: {
    default: false,
    type: 'boolean',
    demandOption: false,
    description: 'Display debug output.',
  },
} as const;

export type TGlobalArguments = Partial<
  yargs.InferredOptionTypes<typeof globalArgumentsOptions>
>;
