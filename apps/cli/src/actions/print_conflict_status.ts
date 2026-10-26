import chalk from 'chalk';
import { TContext } from '../lib/context';
import { logForConflictStatus } from './log';

export function printConflictStatus(
  errMessage: string,
  context: TContext
): void {
  diagnostic(chalk.redBright(errMessage));
  diagnostic('');

  diagnostic(chalk.yellow(`Unmerged files:`));
  diagnostic(
    context.engine
      .getUnmergedFiles()
      .map((line) => chalk.redBright(line))
      .join('\n')
  );
  diagnostic('');

  const rebaseHead = context.engine.getRebaseHead();
  // this should never be undefined in this case, but we don't need to fail here
  if (rebaseHead) {
    diagnostic(
      chalk.yellow(`You are here (resolving ${chalk.blueBright(rebaseHead)}):`)
    );
    logForConflictStatus(rebaseHead, context);
    diagnostic('');
  }

  diagnostic(
    chalk.yellow(`To fix and continue your previous Anthracite command:`)
  );
  diagnostic(`(1) resolve the listed merge conflicts`);
  diagnostic(`(2) mark them as resolved with ${chalk.cyan(`an add .`)}`);
  diagnostic(
    `(3) run ${chalk.cyan(
      `an continue`
    )} to continue executing your previous Anthracite command`
  );
  diagnostic(
    'an rebase --abort only cancels the active rebase; it does not undo earlier completed operations or restore all parent relationships.'
  );
}

function diagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}
