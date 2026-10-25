import { TContext } from '../lib/context';
import { SCOPE } from '../lib/engine/scope_spec';
import {
  ensurePatchInputPrecondition,
  ensureSomeStagedChangesPrecondition,
} from '../lib/preconditions';
import {
  BlockedDuringRebaseError,
  PreconditionsFailedError,
} from '../lib/errors';
import { restackBranches } from './restack';

export function commitCreateAction(
  opts: {
    addAll: boolean;
    patch: boolean;
    message?: string;
  },
  context: TContext
): void {
  if (context.engine.rebaseInProgress()) {
    throw new BlockedDuringRebaseError();
  }

  ensurePatchInputPrecondition(opts.patch && !opts.addAll, context);

  if (
    !context.canEdit &&
    !opts.message?.trim() &&
    (context.engine.detectStagedChanges() ||
      (opts.addAll && context.engine.getStatus().length > 0))
  ) {
    throw new PreconditionsFailedError(
      'Must specify a commit message in non-interactive mode.'
    );
  }

  if (opts.addAll) {
    context.engine.addAll();
  }

  ensureSomeStagedChangesPrecondition(context);
  context.engine.commit({
    message: opts.message,
    patch: !opts.addAll && opts.patch,
  });

  restackBranches(
    context.engine.getRelativeStack(
      context.engine.currentBranchPrecondition,
      SCOPE.UPSTACK_EXCLUSIVE
    ),
    context
  );
}
