import { TContext } from './context';
import { PreconditionsFailedError } from './errors';
import { detectStagedChanges } from './git/diff';
import {
  trackedUncommittedChanges,
  unstagedChanges,
} from './git/git_status_utils';
import { runGitCommand } from './git/runner';

export function getRepoRootPathPrecondition(): string {
  const repoRootPath = runGitCommand({
    args: [`rev-parse`, `--git-common-dir`],
    onError: 'ignore',
    resource: 'getRepoRootPathPrecondition',
  });

  if (!repoRootPath) {
    throw new PreconditionsFailedError('No .git repository found.');
  }
  return repoRootPath;
}

export function uncommittedTrackedChangesPrecondition(): void {
  if (trackedUncommittedChanges()) {
    throw new PreconditionsFailedError(
      `There are tracked changes that have not been committed. Please resolve and then retry.`
    );
  }
}

export function ensureSomeStagedChangesPrecondition(context: TContext): void {
  if (detectStagedChanges()) {
    return;
  }

  if (unstagedChanges()) {
    context.splog.tip(
      'There are unstaged changes. Use the `--all` option to stage all changes.'
    );
  }

  throw new PreconditionsFailedError(`Cannot run without staged changes.`);
}

export function currentGitRepoPrecondition(): string {
  const repoRootPath = runGitCommand({
    args: [`rev-parse`, `--show-toplevel`],
    onError: 'ignore',
    resource: 'currentGitRepoPrecondition',
  });
  if (!repoRootPath) {
    throw new PreconditionsFailedError('No .git repository found.');
  }
  return repoRootPath;
}

export function ensurePatchInputPrecondition(
  patch: boolean,
  context: TContext
): void {
  if (
    patch &&
    !context.canPrompt &&
    context.engine.getUnstagedChanges().length > 0
  ) {
    throw new PreconditionsFailedError(
      '--patch requires interactive terminal input.'
    );
  }
}

export function ensureEditorAllowedPrecondition(context: TContext): void {
  if (!context.canEdit) {
    throw new PreconditionsFailedError(
      'An editor requires interactive mode or a supported explicit input file.'
    );
  }
}
