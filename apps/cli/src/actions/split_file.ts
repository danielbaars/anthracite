import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { planFileSplit } from './split_file_plan';
import { prepareFileSplit } from './split_file_prepare';
import { clearContinuation } from './persist_continuation';
import { restackBranches } from './restack';
import {
  finishFileSplit,
  reportFileSplitFailure,
  reportFileSplitPublicationFailure,
} from './split_file_recovery';

export function splitByFile(
  selectors: readonly string[],
  noVerify: boolean,
  context: TContext
): void {
  const plan = planFileSplit(selectors);
  const prepared = prepareFileSplit(plan, noVerify);
  const current = planFileSplit(selectors);
  if (JSON.stringify(current) !== JSON.stringify(plan))
    throw new PreconditionsFailedError(
      'File split inputs changed during construction. No split refs were published; inspect current refs and work before retrying.'
    );
  let phase = 'extraction publication';
  try {
    context.engine.applyFileSplit({ ...plan, ...prepared });
    phase = 'replay setup';
    context.continueConfig.update((data) => {
      data.branchesToSync ??= [];
      data.branchesToRestack ??= [];
      data.split = {
        source: plan.source,
        parent: plan.generatedName,
        mandatory: plan.descendants.map(({ name }) => name),
        completed: [],
        expected: [
          { name: plan.source, revision: prepared.remainderRevision },
          { name: plan.generatedName, revision: prepared.selectedRevision },
          { name: plan.parent, revision: plan.parentRevision },
          ...plan.descendants,
        ],
      };
    });
    context.splog.info(
      `Extracted selected files into ${plan.generatedName}; retained ${plan.source} as the remainder.`
    );
    phase = 'descendant replay';
    restackBranches(
      plan.descendants.map(({ name }) => name),
      context
    );
    finishFileSplit(context);
  } catch (error) {
    if (context.continueConfig.data.split)
      reportFileSplitFailure(context, phase);
    else
      reportFileSplitPublicationFailure(
        [
          plan.source,
          plan.generatedName,
          plan.parent,
          ...plan.descendants.map(({ name }) => name),
        ],
        context
      );
    throw error;
  }
  clearContinuation(context);
}
