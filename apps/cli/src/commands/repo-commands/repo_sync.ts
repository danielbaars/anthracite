import yargs from 'yargs';
import { syncAction } from '../../actions/sync/sync';
import { abandonSync } from '../../actions/sync/sync_abandon';
import { graphite } from '../../lib/runner';

const args = {
  abort: {
    describe:
      'End only the owned sync locally, retaining reached work and recovery evidence, even after raw Git abort; residual conflicts/files still require deliberate handling.',
    type: 'boolean',
    default: false,
  },
  pull: {
    describe: `Pull the trunk branch from remote.`,
    demandOption: false,
    default: true,
    type: 'boolean',
    alias: 'p',
  },
  delete: {
    describe: `Delete branches which have been merged.`,
    demandOption: false,
    default: true,
    type: 'boolean',
    alias: 'd',
  },
  'delete-all': {
    describe: `Confirm eligible local merged/closed branch cleanup only; does not authorize trunk reset or feature overwrite. Ignored with --no-delete.`,
    demandOption: false,
    default: false,
    type: 'boolean',
  },
  'show-delete-progress': {
    describe: `Show progress through merged branches.`,
    demandOption: false,
    default: false,
    type: 'boolean',
  },
  force: {
    describe: `Don't prompt for confirmation before deleting a branch or resetting trunk to remote.`,
    demandOption: false,
    default: false,
    type: 'boolean',
    alias: 'f',
  },
  restack: {
    describe: `Repair affected tracked branches across the configured trunk. Use --no-restack to defer local maintenance.`,
    demandOption: false,
    default: true,
    type: 'boolean',
    alias: 'r',
  },
} as const;
type argsT = yargs.Arguments<yargs.InferredOptionTypes<typeof args>>;

export const command = 'sync';
export const canonical = 'repo sync';
export const aliases = ['s'];
export const description =
  'Refresh existing tracked open-PR feature heads across the configured trunk, pull trunk, clean eligible merged/closed branches and repair affected tracked stacks by default. No-pull skips only trunk; no-delete suppresses cleanup. Explicit force may reset a divergent trunk, but never authorizes feature overwrite.';
export const builder = args;
export const handler = async (argv: argsT): Promise<void> => {
  if (argv.abort) {
    const conflict = process.argv
      .slice(2)
      .find(
        (value) =>
          /^--(?:no-)?(?:pull|delete|delete-all|show-delete-progress|force|restack)(?:=|$)/.test(
            value
          ) || /^-[^-]*[pdfr]/.test(value)
      );
    try {
      if (conflict)
        throw new Error(
          `--abort cannot be combined with explicit sync options (${conflict}).`
        );
      abandonSync();
    } catch (error) {
      process.stderr.write(
        `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }
  return graphite(argv, canonical, async (context) => {
    await syncAction(
      {
        pull: argv.pull,
        force: argv.force,
        delete: argv.delete,
        deleteAll: argv['delete-all'],
        showDeleteProgress: argv['show-delete-progress'],
        restack: argv.restack,
      },
      context
    );
  });
};
