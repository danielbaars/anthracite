import chalk from 'chalk';
import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { getSha } from '../lib/git/get_sha';
import { TBranchPRInfo } from '../lib/engine/metadata_ref';

export async function showBranchInfo(
  branchName: string,
  opts: {
    readonly patch: boolean;
    readonly diff: boolean;
    readonly body: boolean;
    readonly stat: boolean;
    readonly quiet?: boolean;
  },
  context: TContext
): Promise<void> {
  if (
    context.engine.isTrunk(branchName) &&
    !getSha(`${context.engine.getRevision(branchName)}~`)
  )
    throw new PreconditionsFailedError(
      'Info requires a previous commit when inspecting trunk.'
    );
  const output = getBranchInfo({ branchName }, context);

  const parentBranchName = context.engine.getParent(branchName);
  if (parentBranchName) {
    output.push(`${chalk.cyan('Parent')}: ${parentBranchName}`);
  }

  const children = context.engine.getChildren(branchName);
  if (children.length) {
    output.push(`${chalk.cyan('Children')}:`);
    output.concat(children.map((c) => `▸ ${c}`));
  }

  const body = opts.body && context.engine.getPrInfo(branchName)?.body;
  if (body) {
    output.push('');
    output.push(body);
  }

  output.push('');
  output.push(
    context.engine.showCommits(branchName, opts.patch && !opts.diff, opts.stat)
  );

  if (opts.diff || (opts.stat && !opts.patch)) {
    output.push('');
    output.push(context.engine.showDiff(branchName, opts.stat));
  }

  if (opts.quiet) return;
  if (context.canPage) {
    context.splog.page(output.join('\n'));
  } else {
    // Await delivery so the native runtime flushes large piped pages.
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(`${output.join('\n')}\n`, (error) =>
        error ? reject(error) : resolve()
      );
    });
  }
}

export function getBranchInfo(
  args: {
    branchName: string;
    displayAsCurrent?: boolean;
    showCommitNames?: 'STANDARD' | 'REVERSE';
  },
  context: TContext
): string[] {
  const prInfo = context.engine.isTrunk(args.branchName)
    ? undefined
    : context.engine.getPrInfo(args.branchName);

  const prTitleLine = getPRTitleLine(prInfo);
  const branchInfoLines = [
    `${
      args.displayAsCurrent
        ? chalk.cyan(`${args.branchName} (current)`)
        : chalk.blueBright(args.branchName)
    } ${
      context.engine.isBranchFixed(args.branchName)
        ? ''
        : chalk.yellow(`(needs restack)`)
    }`,
    `${chalk.dim(
      context.engine.getAllCommits(args.branchName, 'COMMITTER_DATE')[0] ?? ''
    )}`,
    ...(prTitleLine ? ['', prTitleLine] : []),
    ...(prInfo?.url ? [chalk.magenta(prInfo.url)] : []),
    '',
    ...(args.showCommitNames
      ? getCommitLines(
          args.branchName,
          args.showCommitNames === 'REVERSE',
          context
        )
      : []),
  ];

  return prInfo?.state === 'MERGED' || prInfo?.state === 'CLOSED'
    ? branchInfoLines.map((line) => chalk.dim.gray(line))
    : branchInfoLines;
}

function getPRTitleLine(prInfo: TBranchPRInfo | undefined): string | undefined {
  if (!prInfo?.title || !prInfo?.number) {
    return undefined;
  }
  const prNumber = `PR #${prInfo.number}`;

  if (prInfo?.state === 'MERGED') {
    return `${prNumber} (Merged) ${prInfo.title}`;
  } else if (prInfo?.state === 'CLOSED') {
    return `${prNumber} (Abandoned) ${chalk.strikethrough(`${prInfo.title}`)}`;
  } else {
    return `${chalk.yellow(prNumber)} ${getPRState(prInfo)} ${prInfo.title}`;
  }
}

function getPRState(prInfo: TBranchPRInfo | undefined): string {
  if (prInfo === undefined) {
    return '';
  }

  if (prInfo.isDraft) {
    return chalk.gray('(Draft)');
  }

  const reviewDecision = prInfo.reviewDecision;
  switch (reviewDecision) {
    case 'APPROVED':
      return chalk.green('(Approved)');
    case 'CHANGES_REQUESTED':
      return chalk.magenta('(Changes Requested)');
    case 'REVIEW_REQUIRED':
      return chalk.yellow('(Review Required)');
    default:
      // Intentional fallthrough - if there's no review decision, that means that
      // review isn't required and we can skip displaying a review status.
      return '';
  }
}

function getCommitLines(
  branchName: string,
  reverse: boolean,
  context: TContext
) {
  const lines = context.engine
    .getAllCommits(branchName, 'READABLE')
    .map((line) => chalk.gray(line));

  return reverse ? lines.reverse() : lines;
}
