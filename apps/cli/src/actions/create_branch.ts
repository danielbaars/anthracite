import { getWorkState } from '../lib/git/work_state';
import { readIndex, restoreIndex } from '../lib/git/index_state';
import { addPatch } from '../lib/git/add_patch';
import { assertBranchesAvailableInWorktrees } from '../lib/git/worktrees';
import { hasCreateChanges } from '../lib/git/create_changes';
import { assertRestackFilesAvailable } from '../lib/git/restack_files';
import { ensurePatchInputPrecondition } from '../lib/preconditions';
import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import { ExitFailedError } from '../lib/errors';
import { newBranchName } from '../lib/utils/branch_name';
import { getBranchesToRestack, restackBranches } from './restack';

type TCreateBranchOptions = {
  branchName?: string;
  onto?: string;
  message?: string;
  all?: boolean;
  insert?: boolean;
  patch?: boolean;
};

export async function createBranchAction(
  opts: TCreateBranchOptions,
  context: TContext
): Promise<void> {
  ensurePatchInputPrecondition(Boolean(opts.patch && !opts.all), context);

  const branchName = newBranchName(opts.branchName, opts.message, context);
  if (!branchName) {
    throw new ExitFailedError(
      `Must specify either a branch name or commit message.`
    );
  }

  if (
    !context.canEdit &&
    !opts.message?.trim() &&
    (context.engine.detectStagedChanges() ||
      (opts.all && context.engine.getStatus().length > 0))
  ) {
    throw new ExitFailedError(
      'Must specify a commit message in non-interactive mode.'
    );
  }

  const sourceBranch = context.engine.currentBranch;
  const insertChildren = opts.insert
    ? getInsertChildren(opts, context)
    : undefined;
  const originalIndex = opts.onto !== undefined ? readIndex() : undefined;
  context.engine.checkoutNewBranch(branchName, opts.onto);

  commitNewBranch(
    { ...opts, branchName, sourceBranch, originalIndex },
    context
  );

  // The reason we get the list of siblings here instead of having all
  // the `--insert` logic in a separate function is so that we only
  // show the tip if the user creates a branch with siblings.

  const siblings =
    insertChildren ??
    context.engine
      .getChildren(context.engine.getParentPrecondition(branchName))
      .filter((childBranchName) => childBranchName !== branchName);

  if (siblings.length === 0) {
    return;
  }

  if (!opts.insert) {
    context.splog.tip(
      [
        'To insert a created branch into the middle of your stack, use the `--insert` flag.',
        "If you meant to insert this branch, you can rearrange your stack's dependencies with `ch move`",
      ].join('\n')
    );
    return;
  }

  insertBranch(branchName, siblings, context);
}

function insertBranch(
  branchName: string,
  children: readonly string[],
  context: TContext
): void {
  context.splog.info(
    `Created branch ${branchName} at ${context.engine
      .getRevision(branchName)
      .slice(0, 7)}; inserting beneath the chosen parent's existing children.`
  );
  try {
    children.forEach((child) => context.engine.setParent(child, branchName));
    const branches = children.flatMap((child) =>
      context.engine.getRelativeStack(child, SCOPE.UPSTACK)
    );
    const changingBranches = getBranchesToRestack(branches, context);
    if (
      changingBranches.length > 0 &&
      (context.engine.detectStagedChanges() ||
        context.engine.getUnstagedChanges().length > 0)
    ) {
      throw new ExitFailedError(
        'Cannot restack inserted children with remaining tracked changes after commit. Preserve or commit that work before retrying.'
      );
    }
    // Hooks run after the first preflight; their remaining work was not selected by --all.
    assertRestackFilesAvailable({
      branches: changingBranches.map((name) => ({
        name,
        from: context.engine.getBaseRevision(name),
      })),
      all: false,
      operation: 'insert',
    });
    restackBranches(branches, context);
  } catch (e) {
    if (context.engine.rebaseInProgress()) {
      context.splog.warn(
        `Insertion is incomplete. Aborting with ch rebase --abort keeps ${branchName} and its commit, parent changes and completed restacks; it only cancels the active rebase.`
      );
    } else {
      context.splog.warn(
        `Insertion is incomplete. ${branchName}, its commit and changed parent relationships remain; completed restacks are retained. Resolve the reported problem, then run ch restack --upstack from ${branchName}. No rebase is active.`
      );
    }
    throw e;
  }
}

function getInsertChildren(
  opts: TCreateBranchOptions,
  context: TContext
): string[] {
  const parent = opts.onto ?? context.engine.currentBranchPrecondition;
  const scope = context.engine.getRelativeStack(parent, SCOPE.UPSTACK);
  const children = scope.filter(
    (branch) => context.engine.getParent(branch) === parent
  );
  const createsCommit =
    hasCreateChanges(parent, opts.all ?? false) ||
    (opts.patch && context.engine.getUnstagedChanges().length > 0);
  const branchesToRestack = getBranchesToRestack(
    scope.filter((branch) => branch !== parent),
    context,
    { willChange: createsCommit ? children : [] }
  );
  assertBranchesAvailableInWorktrees([...children, ...branchesToRestack]);
  if (
    branchesToRestack.length > 0 &&
    !opts.all &&
    context.engine.getUnstagedChanges().length > 0
  ) {
    throw new ExitFailedError(
      'Cannot insert with unstaged tracked changes when restacking is required. Stage or commit them, or use --all, then retry.'
    );
  }
  assertRestackFilesAvailable({
    branches: branchesToRestack.map((name) => ({
      name,
      from: context.engine.getBaseRevision(name),
    })),
    all: opts.all ?? false,
    operation: 'insert',
  });
  return children;
}

function commitNewBranch(
  opts: TCreateBranchOptions & {
    branchName: string;
    sourceBranch?: string;
    originalIndex?: Buffer;
  },
  context: TContext
): void {
  if (opts.all) {
    context.engine.addAll();
  }

  if (opts.onto !== undefined && opts.patch && !opts.all) {
    addPatch();
  }

  if (context.engine.detectStagedChanges()) {
    const preparedWork = opts.onto !== undefined ? getWorkState() : undefined;
    try {
      context.engine.commit({
        message: opts.message,
        patch: opts.onto === undefined && !opts.all && opts.patch,
      });
    } catch (e) {
      try {
        if (preparedWork !== undefined && preparedWork !== getWorkState()) {
          context.splog.warn(
            `Commit failed after a hook or external process changed your work; retained ${opts.branchName} and its checkout, index, and files. Inspect them before retrying.`
          );
        } else {
          if (opts.onto !== undefined && opts.sourceBranch) {
            context.engine.checkoutBranch(opts.sourceBranch, {
              preserveIgnored: true,
            });
          }
          if (opts.originalIndex) restoreIndex(opts.originalIndex);
          context.engine.deleteBranch(opts.branchName);
        }
      } catch {
        context.splog.warn(
          `Could not clean up ${opts.branchName}; inspect your checkout and work before retrying.`
        );
      }
      throw e;
    }
  } else {
    context.splog.info(`No staged changes; created a branch with no commit.`);
  }
}
