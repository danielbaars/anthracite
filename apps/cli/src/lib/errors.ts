import chalk from 'chalk';

export class ExitFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExitFailed';
  }
}

export class RebaseCheckoutError extends ExitFailedError {
  constructor(
    readonly branchName: string,
    args: { returnBranch: string; checkout: string | undefined; cause: unknown }
  ) {
    super(
      `Rewrite of ${branchName} completed, but return to ${
        args.returnBranch
      } failed. Actual checkout: ${args.checkout ?? 'detached HEAD'}. ${
        args.cause instanceof Error ? args.cause.message : String(args.cause)
      }`
    );
    this.name = 'RebaseCheckoutError';
  }
}

export class RebaseMetadataError extends ExitFailedError {
  constructor(readonly branchName: string, cause: unknown) {
    super(
      `Rewrite of ${branchName} completed, but metadata publication failed. ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'RebaseMetadataError';
  }
}

export class NonInteractiveError extends Error {
  constructor() {
    super('Cannot perform interactive operation in non-interactive mode.');
    this.name = 'NonInteractive';
  }
}

export class RebaseConflictError extends Error {
  constructor() {
    super(`Hit a conflict during rebase.`);
    this.name = 'RebaseConflict';
  }
}

export class PreconditionsFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconditionsFailed';
  }
}

export class ConcurrentExecutionError extends Error {
  constructor() {
    super(`Cannot run more than one Anthracite process at once.`);
    this.name = 'ConcurrentExecutionError';
  }
}

export class DetachedError extends Error {
  constructor(extraMsg?: string) {
    const baseMsg = `Cannot perform this operation without a branch checked out.`;
    super(extraMsg ? [baseMsg, extraMsg].join('\n') : baseMsg);
    this.name = 'DetachedError';
  }
}

export class NoBranchError extends Error {
  constructor(branchName: string) {
    super(`Could not find branch ${chalk.yellow(branchName)}.`);
    this.name = 'NoBranchError';
  }
}

export class UntrackedBranchError extends Error {
  constructor(branchName: string) {
    super(
      [
        `Cannot perform this operation on untracked branch ${chalk.yellow(
          branchName
        )}.`,
        `You can track it by specifying its parent with ${chalk.cyan(
          `an track`
        )}.`,
      ].join('\n')
    );
    this.name = 'UntrackedBranchError';
  }
}

export class BadTrunkOperationError extends Error {
  constructor() {
    super(`Cannot perform this operation on the trunk branch.`);
    this.name = 'BadTrunkOperationError';
  }
}

export class KilledError extends Error {
  constructor() {
    super(`Killed Anthracite early.`);
    this.name = 'Killed';
  }
}

export class BlockedDuringRebaseError extends Error {
  constructor() {
    super(
      [
        `This operation is blocked during a rebase.`,
        `You may still use git directly, and continue with ${chalk.cyan(
          'an continue'
        )}.`,
      ].join('\n')
    );
    this.name = 'BlockedDuringRebase';
  }
}

export class NoGraphiteContinue extends Error {
  constructor(didYouMean?: string) {
    const baseMsg = `No Anthracite operation to continue.`;
    super(
      didYouMean
        ? [baseMsg, `Did you mean ${chalk.cyan(didYouMean)}?`].join('\n')
        : baseMsg
    );
    this.name = 'NoGraphiteContinue';
  }
}
