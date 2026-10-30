import fs from 'fs';
import { TextDecoder } from 'util';
import yargs from 'yargs';
import { selectPrBranch } from '../actions/pr_selection';
import { reviewPr } from '../actions/review_pr';
import { ReviewEvent } from '../lib/api/github_review';
import { graphiteInspection } from '../lib/runner';

export const command = 'review [branch]';
export const canonical = 'review';
export const description =
  'Inspect the selected GitHub pull request diff or submit one explicit head-bound review.';
const options = {
  approve: {
    type: 'boolean',
    describe: 'Submit one approval review (not a reviewer request).',
  },
  'request-changes': {
    type: 'boolean',
    describe: 'Submit one changes-requested review; requires a body.',
  },
  comment: {
    type: 'boolean',
    describe: 'Submit one comment review; requires a body.',
  },
  head: {
    type: 'string',
    describe:
      'Full expected 40-character pull request head OID; required for a review action.',
  },
  body: {
    type: 'string',
    describe: 'One literal review body; preserves multiline Markdown.',
  },
  'body-file': {
    type: 'string',
    describe: 'UTF-8 review body file; stdin (-) is unsupported.',
  },
} as const;
export const builder = (cli: yargs.Argv): yargs.Argv =>
  cli
    .parserConfiguration({ 'parse-positional-numbers': false })
    .options(options)
    .positional('branch', { type: 'string' })
    .check((argv) => {
      for (const argument of process.argv.slice(2)) {
        if (argument === '--') break;
        if (/^--(?:no-)?branch(?:=|$)/.test(argument))
          throw new Error('review accepts a positional branch name only.');
        if (
          /^--(?:no-)?(?:approve|request-changes|comment)=(?!true$|false$)/.test(
            argument
          )
        )
          throw new Error('review action options require true or false.');
      }
      if (argv._.length > 1 || argv.branch === '')
        throw new Error(
          'review accepts at most one nonempty positional branch.'
        );
      for (const key of Object.keys(options))
        if (Array.isArray(argv[key]))
          throw new Error(`review accepts only one --${key} value.`);
      for (const key of ['head', 'body', 'body-file'])
        if (argv[key] !== undefined && typeof argv[key] !== 'string')
          throw new Error(`review requires one literal string for --${key}.`);
      const actions = [
        argv.approve,
        argv['request-changes'],
        argv.comment,
      ].filter((value) => value === true).length;
      if (actions > 1)
        throw new Error('Review actions are mutually exclusive.');
      if (
        actions === 0 &&
        [argv.head, argv.body, argv['body-file']].some(
          (value) => value !== undefined
        )
      )
        throw new Error(
          'Review head and body options require one explicit action.'
        );
      if (
        actions === 1 &&
        (typeof argv.head !== 'string' || !/^[a-f0-9]{40}$/.test(argv.head))
      )
        throw new Error(
          'A review action requires --head with the full expected 40-character OID.'
        );
      if (argv.body !== undefined && argv['body-file'] !== undefined)
        throw new Error('Use exactly one of --body or --body-file.');
      return true;
    });
export const handler = async (
  argv: yargs.Arguments<
    yargs.InferredOptionTypes<typeof options> & { branch?: string }
  >
): Promise<void> => {
  await graphiteInspection(argv, async (context) => {
    let body = argv.body ?? '';
    if (argv['body-file'] !== undefined) {
      if (!argv['body-file'] || argv['body-file'] === '-')
        throw new Error(
          'A readable UTF-8 body file is required; stdin is unsupported.'
        );
      try {
        body = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(fs.readFileSync(argv['body-file']));
      } catch {
        throw new Error('Cannot read --body-file as UTF-8.');
      }
    }
    const event: ReviewEvent | undefined = argv.approve
      ? 'APPROVE'
      : argv['request-changes']
      ? 'REQUEST_CHANGES'
      : argv.comment
      ? 'COMMENT'
      : undefined;
    if (event && event !== 'APPROVE' && !body.trim())
      throw new Error('This review action requires a non-whitespace body.');
    await reviewPr(
      selectPrBranch(argv.branch, context),
      context,
      event ? { event, body, head: argv.head ?? '' } : undefined
    );
  });
};
