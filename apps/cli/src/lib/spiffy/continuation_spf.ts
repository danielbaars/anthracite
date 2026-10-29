import * as t from '@withgraphite/retype';
import { spiffy } from './spiffy';

/**
 * After Graphite is interrupted by a merge conflict, upon continuing, there
 * are 3 main things we need to do, in the following order.
 *
 * 1) Complete the original rebase operation.
 * 2) Sync any remaining branches from remote.
 * 3) Restack any remaining branches that were queued.
 *
 * The below object persists the queue of branches to be restacked.
 * We also store the Graphite current branch, so that we can switch back to it.
 * We need to keep track of the new parentBranchRevision for the branch that
 * hit a merge conflict, as we cannot pull this information from Git.
 */
const ContinueSchema = t.shape({
  getImportDecisions: t.optional(
    t.array(
      t.shape({
        branchName: t.string,
        wasTracked: t.boolean,
        frozen: t.boolean,
      })
    )
  ),
  branchesToSync: t.array(t.string),
  branchesToRestack: t.array(t.string),
  currentBranchOverride: t.optional(t.string),
  rebasedBranchBase: t.optional(t.string),
  rebaseOwnership: t.optional(t.string),
  absorb: t.optional(
    t.shape({
      directory: t.string,
      construction: t.optional(t.boolean),
      source: t.string,
      mandatory: t.array(t.string),
      completed: t.array(t.string),
    })
  ),
  delete: t.optional(
    t.shape({ branch: t.string, mandatory: t.array(t.string) })
  ),
  split: t.optional(
    t.shape({
      source: t.string,
      parent: t.string,
      mandatory: t.array(t.string),
      completed: t.array(t.string),
      expected: t.optional(
        t.array(
          t.shape({
            name: t.string,
            revision: t.string,
            from: t.optional(t.string),
          })
        )
      ),
    })
  ),
  insert: t.optional(
    t.shape({
      branch: t.string,
      mandatory: t.array(t.string),
      completed: t.array(t.string),
    })
  ),
  reorder: t.optional(
    t.shape({
      returnBranch: t.string,
      graphApplied: t.boolean,
      plan: t.array(
        t.shape({ name: t.string, parent: t.string, from: t.string })
      ),
      completed: t.array(t.string),
      pending: t.array(t.string),
      checkout: t.optional(t.string),
      conflictBranch: t.optional(t.string),
    })
  ),
  fold: t.optional(
    t.shape({
      survivor: t.string,
      removed: t.array(t.string),
      mandatory: t.optional(t.array(t.string)),
      completed: t.array(t.string),
    })
  ),
  move: t.optional(
    t.shape({
      source: t.string,
      only: t.boolean,
      returnBranch: t.string,
      mandatory: t.optional(t.array(t.string)),
      completed: t.array(t.string),
    })
  ),
});

export const continueConfigFactory = spiffy({
  schema: ContinueSchema,
  defaultLocations: [
    {
      relativePath: '.gtcontinue',
      relativeTo: 'REPO',
    },
  ],
  initialize: () => {
    return {};
  },
  helperFunctions: () => {
    return {} as const;
  },
  options: { removeIfEmpty: true, removeIfInvalid: true },
});

export type TContinueConfig = ReturnType<typeof continueConfigFactory.load>;
