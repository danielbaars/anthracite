import { execFileSync } from 'child_process';
import * as t from '@withgraphite/retype';
import { assertBranchEditable } from '../../lib/engine/frozen_branch';

type AssigneeTarget = {
  head: string;
  number: number;
  repo: string;
};

const assigneeStateSchema = t.shape({
  headRefName: t.string,
  number: t.number,
  assignees: t.array(t.shape({ login: t.string })),
});

function readAssignees(target: AssigneeTarget): string[] {
  const value: unknown = JSON.parse(
    execFileSync('gh', [
      'pr',
      'view',
      String(target.number),
      '--repo',
      target.repo,
      '--json',
      'headRefName,number,assignees',
    ]).toString()
  );
  if (
    !assigneeStateSchema(value) ||
    value.headRefName !== target.head ||
    value.number !== target.number
  ) {
    throw new Error(
      `Could not verify assignees for ${target.head}: invalid PR response`
    );
  }
  return value.assignees.map((assignee) => assignee.login.toLowerCase());
}

export function requestAssignees(
  target: AssigneeTarget,
  assignees: readonly string[]
): void {
  if (!assignees.length) return;
  const before = readAssignees(target);
  const additions = assignees.filter(
    (assignee) => !before.includes(assignee.toLowerCase())
  );
  if (!additions.length) return;
  assertBranchEditable(target.head);
  let failure: unknown;
  try {
    execFileSync('gh', [
      'pr',
      'edit',
      String(target.number),
      '--repo',
      target.repo,
      ...additions.flatMap((assignee) => ['--add-assignee', assignee]),
    ]);
  } catch (error) {
    failure = error;
  }
  let after: string[];
  try {
    after = readAssignees(target);
  } catch (error) {
    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }. Unverified assignees: ${additions.join(
        ', '
      )}. Confirmed assignees before update: ${
        assignees
          .filter((name) => before.includes(name.toLowerCase()))
          .join(', ') || 'none'
      }`
    );
  }
  const missing = assignees.filter(
    (assignee) => !after.includes(assignee.toLowerCase())
  );
  if (missing.length || failure !== undefined) {
    const confirmed = assignees.filter(
      (assignee) => !missing.includes(assignee)
    );
    throw new Error(
      `Assignment ${failure !== undefined ? 'failed' : 'not confirmed'} for ${
        missing.join(', ') || additions.join(', ')
      } on ${target.head}. Confirmed assignees: ${
        confirmed.join(', ') || 'none'
      }${
        failure !== undefined
          ? `. ${failure instanceof Error ? failure.message : String(failure)}`
          : ''
      }`
    );
  }
}
