import chalk from 'chalk';
import { TContext } from '../lib/context';
import { getPendingSyncLogNotice, getSyncReconciliationLines } from './log';
import {
  isPendingSyncReconciliation,
  readSyncReconciliation,
} from '../lib/engine/sync_reconciliation';

function displayBranchesInternal(
  opts: {
    branchName: string;
    highlightCurrentBranch?: boolean;
    omitCurrentBranch?: boolean;
    indent?: number;
    hidden?: ReadonlySet<string>;
  },
  context: TContext
): { display: string; branchName: string }[] {
  const currentBranchName = context.engine.currentBranch;
  const currentChoice = {
    display: `${'  '.repeat(opts.indent ?? 0)}↱ $ ${opts.branchName}${
      context.engine.isBranchFixed(opts.branchName)
        ? ''
        : chalk.yellowBright(` (needs restack)`)
    }`,
    branchName: opts.branchName,
  };
  return (
    context.engine
      .getChildren(opts.branchName)
      ?.filter(
        (b) =>
          !opts.hidden?.has(b) &&
          (b !== currentBranchName || !opts.omitCurrentBranch)
      )
      .map((b) =>
        displayBranchesInternal(
          {
            ...opts,
            branchName: b,
            indent: (opts.indent ?? 0) + 1,
          },
          context
        )
      )
      .reduceRight((acc, arr) => arr.concat(acc), [currentChoice]) ?? []
  );
}

export function logShortClassic(context: TContext): void {
  const notice = getPendingSyncLogNotice(context);
  if (notice) context.splog.info(notice);
  const { entries } = readSyncReconciliation();
  const hidden = new Set(
    context.engine.allBranchNames.filter((name) =>
      isPendingSyncReconciliation(name, entries)
    )
  );
  context.splog.page(
    displayBranchesInternal(
      {
        branchName: context.engine.trunk,
        highlightCurrentBranch: true,
        hidden,
      },
      context
    )
      .map((b) => b.display)
      .concat(
        getSyncReconciliationLines(entries, context.engine.allBranchNames)
      )
      .join('\n')
  );
}
