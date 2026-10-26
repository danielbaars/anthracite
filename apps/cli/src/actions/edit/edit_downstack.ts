import { ensureEditorAllowedPrecondition } from '../../lib/preconditions';
import { TContext } from '../../lib/context';
import { PreconditionsFailedError } from '../../lib/errors';
import { SCOPE } from '../../lib/engine/scope_spec';
import { performInTmpDir } from '../../lib/utils/perform_in_tmp_dir';
import { getBranchesToRestack, restackBranches } from '../restack';
import { createStackEditFile, parseEditFile } from './stack_edit_file';
import { beginReorder, finishReorder } from '../reorder_recovery';
import { clearContinuation } from '../persist_continuation';
import { assertNoGitOperation } from '../../lib/git/assert_no_operation';

export async function editDownstack(
  inputPath: string | undefined,
  context: TContext
): Promise<void> {
  assertNoGitOperation('reorder');
  context.engine.assertBranchEditable(context.engine.currentBranchPrecondition);
  if (!inputPath) ensureEditorAllowedPrecondition(context);
  // First, reorder the parent pointers of the branches
  const branchNames = inputPath
    ? parseEditFile(inputPath) // allow users to pass a pre-written file, mostly for unit tests.
    : await promptForEdit(context);
  const top = branchNames[branchNames.length - 1];
  if (!top)
    throw new PreconditionsFailedError('Reorder requires at least one branch.');
  const parents = new Map<string, string>();
  let parent = context.engine.trunk;
  for (const name of branchNames) {
    parents.set(name, parent);
    parent = name;
  }
  const branches = [
    ...new Set(
      branchNames.flatMap((name) =>
        context.engine.getRelativeStack(name, SCOPE.UPSTACK)
      )
    ),
  ];
  const reparented = branchNames.filter(
    (name) => context.engine.getParent(name) !== parents.get(name)
  );
  const restackOrder = [
    ...branchNames,
    ...branches.filter((name) => !branchNames.includes(name)),
  ];
  const changing = getBranchesToRestack(restackOrder, context, { parents });
  const mandatory = restackOrder.filter(
    (name) => reparented.includes(name) || changing.includes(name)
  );
  for (const name of new Set([
    context.engine.currentBranchPrecondition,
    ...mandatory,
  ]))
    context.engine.assertBranchEditable(name);
  for (const name of branches)
    if (!parents.has(name))
      parents.set(name, context.engine.getParentPrecondition(name));
  beginReorder(
    {
      returnBranch: top,
      order: branchNames,
      parents,
      original: new Map(
        branches.map((name) => [
          name,
          { from: context.engine.getBaseRevision(name) },
        ])
      ),
      pending: mandatory,
    },
    context
  );

  // We to check out the top of the new stack BEFORE we restack in case of conflicts.
  context.engine.checkoutBranch(top);
  restackBranches(mandatory, context);
  finishReorder(context);
  clearContinuation(context);
}

async function promptForEdit(context: TContext): Promise<string[]> {
  const branchNames = context.engine.getRelativeStack(
    context.engine.currentBranchPrecondition,
    SCOPE.DOWNSTACK
  );
  return performInTmpDir((tmpDir) => {
    const editFilePath = createStackEditFile({ branchNames, tmpDir }, context);
    context.userConfig.execEditor(editFilePath);
    return parseEditFile(editFilePath);
  });
}
