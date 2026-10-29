import yargs from 'yargs';

import {
  applyAbsorb,
  assertAbsorbApplicationAvailable,
} from '../actions/absorb_apply';
import {
  inspectAbsorbSource,
  planAbsorb,
  printAbsorbPlan,
} from '../actions/absorb_plan';
import {
  checkAbsorbSource,
  prepareAbsorbStaging,
} from '../actions/absorb_staging';
import { PreconditionsFailedError } from '../lib/errors';
import { graphiteInspection } from '../lib/runner';

const options = {
  force: {
    alias: 'f',
    type: 'boolean',
    default: false,
    describe:
      'Skip plan confirmation; required for noninteractive or quiet application.',
  },
  'dry-run': {
    alias: 'd',
    type: 'boolean',
    default: false,
    describe:
      'Preview without changing refs, the real index or working files; incompatible with --patch.',
  },
  all: {
    alias: 'a',
    type: 'boolean',
    default: false,
    describe:
      'Stage tracked modifications/deletions only; retain existing staged entries; incompatible with --patch.',
  },
  patch: {
    alias: 'p',
    type: 'boolean',
    default: false,
    describe:
      'Select text hunks with real Git terminal input, even with --force; incompatible with --all and --dry-run.',
  },
} as const;

export const command = 'absorb';
export const aliases = ['ab'];
export const description =
  'Absorb staged text corrections into their original commits and replay required descendants.';
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .showHelpOnFail(false)
    .options(options)
    .epilog(
      'Existing regular text entries only. Unsupported entries and unmatched hunks remain staged and are reported. Frozen or occupied required participants refuse before changes. No remote operations. Earlier amendments survive abort; retained input and explicit recovery instructions are printed on failure. Committer identity/signatures follow ordinary Git commits.'
    )
    .check((argv) => {
      if (argv._.length !== 1)
        throw new Error('absorb does not accept positional arguments.');
      if (argv.all && argv.patch)
        throw new Error('absorb --all and --patch are mutually exclusive.');
      if (argv['dry-run'] && argv.patch)
        throw new Error('absorb --dry-run cannot be combined with --patch.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<yargs.InferredOptionTypes<typeof options>>
): Promise<void> => {
  return graphiteInspection(argv, async (context) => {
    if (
      [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      ].some((name) => process.env[name] !== undefined)
    )
      throw new PreconditionsFailedError(
        'Absorb does not support Git environment redirection. Unset repository/index overrides before retrying.'
      );
    if (!argv['dry-run'] && !argv.force && !context.canPrompt)
      throw new PreconditionsFailedError(
        'Absorb application requires --force without supported terminal confirmation. Use --dry-run to preview.'
      );
    if (argv.patch && !context.canPrompt)
      throw new PreconditionsFailedError(
        'Absorb --patch requires supported terminal interaction, even with --force.'
      );
    if (!argv.all && !argv.patch) inspectAbsorbSource(context);
    const staging =
      argv.all || argv.patch
        ? prepareAbsorbStaging(context, argv.patch)
        : undefined;
    try {
      const checkSource = checkAbsorbSource();
      const plan = staging?.plan ?? planAbsorb(context);
      if (!staging) assertAbsorbApplicationAvailable(plan, context);
      if (argv['dry-run']) {
        if (!argv.quiet) printAbsorbPlan(plan);
        return;
      }
      if (!argv.force && (plan.targets.length || plan.leftovers.length)) {
        printAbsorbPlan(plan, false);
        const answer = await context.prompts({
          type: 'confirm',
          name: 'apply',
          initial: false,
          message: 'Apply this absorb plan?',
        });
        if (!answer.apply) {
          context.splog.info('Absorb canceled; no changes applied.');
          return;
        }
      }
      checkSource();
      applyAbsorb(plan, context, argv.verify === false, () => {
        checkSource();
        if (staging) staging.publish();
        else planAbsorb(context);
      });
      if (staging && !plan.targets.length && !context.quiet)
        process.stdout.write(
          plan.leftovers.length
            ? 'Requested staging completed; nothing was absorbed.\n'
            : 'No changes selected; nothing was absorbed.\n'
        );
    } finally {
      staging?.cleanup();
    }
  });
};
