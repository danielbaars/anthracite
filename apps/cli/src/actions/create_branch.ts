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
import { clearContinuation } from './persist_continuation';

type TCreateBranchOptions = {
  branchName?: string;
  onto?: string;
  message?: string;
  all?: boolean;
  insert?: boolean;
  readonly insertChildren?: readonly string[];
  patch?: boolean;
};

export async function createBranchAction(
  opts: TCreateBranchOptions,
  context: TContext
): Promise<void> {
  if (opts.insertChildren !== undefined && !opts.insert) {
    throw new ExitFailedError('--insert-child requires an active --insert.');
  }
  const selection = opts.insert ? getInsertChildren(opts, context) : undefined;
  let insertPlan = selection
    ? getInsertPlan({ ...opts, ...selection }, context)
    : undefined;

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
  const originalIndex = opts.onto !== undefined ? readIndex() : undefined;
  context.engine.checkoutNewBranch(branchName, opts.onto);
  if (insertPlan) {
    try {
      insertPlan = getInsertPlan({ ...opts, ...insertPlan }, context);
    } catch (error) {
      context.splog.warn(
        `Insertion stopped after creating ${branchName}; its checkout, index and files remain. Existing children have not been reparented.`
      );
      throw error;
    }
  }

  commitNewBranch(
    {
      ...opts,
      branchName,
      sourceBranch,
      originalIndex,
      participants: insertPlan?.mandatory,
    },
    context
  );

  // The reason we get the list of siblings here instead of having all
  // the `--insert` logic in a separate function is so that we only
  // show the tip if the user creates a branch with siblings.

  const siblings =
    insertPlan?.children ??
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
        "If you meant to insert this branch, you can rearrange your stack's dependencies with `an move`",
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
      .slice(0, 7)}; inserting between ${context.engine.getParentPrecondition(
      branchName
    )} and chosen children: ${children.join(', ')}.`
  );
  try {
    const branches = children.flatMap((child) =>
      context.engine.getRelativeStack(child, SCOPE.UPSTACK)
    );
    const parents = new Map(children.map((child) => [child, branchName]));
    const mandatory = [
      ...new Set([
        ...children,
        ...getBranchesToRestack(branches, context, { parents }),
      ]),
    ];
    for (const name of mandatory) context.engine.assertBranchEditable(name);
    context.continueConfig.update((data) => {
      data.branchesToSync ??= [];
      data.branchesToRestack ??= [];
      data.insert = { branch: branchName, mandatory, completed: [] };
    });
    for (const child of children) {
      for (const name of mandatory) context.engine.assertBranchEditable(name);
      context.engine.setParent(child, branchName, mandatory);
    }
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
    clearContinuation(context);
  } catch (e) {
    if (context.engine.rebaseInProgress()) {
      context.splog.warn(
        `Insertion is incomplete. Aborting with an rebase --abort keeps ${branchName} and its commit, parent changes and completed restacks; it only cancels the active rebase.`
      );
    } else {
      context.splog.warn(
        `Insertion is incomplete. ${branchName}, its commit and changed parent relationships remain; completed restacks are retained. Resolve the reported problem, then run an restack --upstack from ${branchName}. No rebase is active.`
      );
    }
    throw e;
  }
}

function getInsertChildren(
  opts: TCreateBranchOptions,
  context: TContext
): { readonly parent: string; readonly children: readonly string[] } {
  const parent = opts.onto ?? context.engine.currentBranchPrecondition;
  const scope = context.engine.getRelativeStack(parent, SCOPE.UPSTACK);
  const children = scope.filter(
    (branch) => context.engine.getParent(branch) === parent
  );
  if (opts.insertChildren === undefined) return { parent, children };
  const requested = opts.insertChildren;
  if (
    requested.some((child) => typeof child !== 'string' || child.length === 0)
  ) {
    throw new ExitFailedError(
      '--insert-child requires a nonempty branch name.'
    );
  }
  const invalid = requested.filter((child) => !children.includes(child));
  if (invalid.length > 0) {
    throw new ExitFailedError(
      `Not tracked direct children of ${parent}: ${[...new Set(invalid)].join(
        ', '
      )}.`
    );
  }
  return {
    parent,
    children: children.filter((child) => requested.includes(child)),
  };
}

function getInsertPlan(
  opts: TCreateBranchOptions & {
    readonly parent: string;
    readonly children: readonly string[];
  },
  context: TContext
): {
  readonly parent: string;
  readonly children: readonly string[];
  readonly mandatory: readonly string[];
} {
  const { parent, children } = opts;
  const createsCommit =
    hasCreateChanges(parent, opts.all ?? false) ||
    (opts.patch && context.engine.getUnstagedChanges().length > 0);
  const branchesToRestack = getBranchesToRestack(
    children.flatMap((child) =>
      context.engine.getRelativeStack(child, SCOPE.UPSTACK)
    ),
    context,
    { willChange: createsCommit ? children : [] }
  );
  const mandatory = [...new Set([...children, ...branchesToRestack])];
  for (const name of mandatory) context.engine.assertBranchEditable(name);
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
  return { parent, children, mandatory };
}

function commitNewBranch(
  opts: TCreateBranchOptions & {
    branchName: string;
    sourceBranch?: string;
    originalIndex?: Buffer;
    readonly participants?: readonly string[];
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
        participants: opts.participants,
      });
    } catch (e) {
      if (
        opts.participants?.some((name) => context.engine.isBranchFrozen(name))
      ) {
        context.splog.warn(
          `Insertion stopped after creating ${opts.branchName}; its checkout, index and files remain. Existing children have not been reparented.`
        );
        throw e;
      }
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
