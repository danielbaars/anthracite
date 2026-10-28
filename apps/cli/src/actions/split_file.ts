import { TContext } from '../lib/context';
import { PreconditionsFailedError } from '../lib/errors';
import { planFileSplit } from './split_file_plan';
import { prepareFileSplit } from './split_file_prepare';
import { clearContinuation } from './persist_continuation';
import { restackBranches } from './restack';

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
  context.engine.applyFileSplit({ ...plan, ...prepared });
  context.continueConfig.update((data) => {
    data.branchesToSync ??= [];
    data.branchesToRestack ??= [];
    data.split = {
      source: plan.source,
      parent: plan.generatedName,
      mandatory: plan.descendants.map(({ name }) => name),
      completed: [],
    };
  });
  context.splog.info(
    `Extracted selected files into ${plan.generatedName}; retained ${plan.source} as the remainder.`
  );
  restackBranches(
    plan.descendants.map(({ name }) => name),
    context
  );
  context.engine.checkoutBranch(plan.source, { preserveIgnored: true });
  clearContinuation(context);
}
