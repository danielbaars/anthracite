import * as t from '@withgraphite/retype';
import { execFileSync } from 'child_process';

const prStatusSchema = t.shape({
  headRefName: t.string,
  number: t.number,
  isDraft: t.boolean,
});

export function readPrDraftStatus(
  head: string,
  number: number,
  repo: string
): boolean {
  try {
    const status: unknown = JSON.parse(
      execFileSync('gh', [
        'pr',
        'view',
        String(number),
        '--repo',
        repo,
        '--json',
        'headRefName,number,isDraft',
      ]).toString()
    );
    if (
      !prStatusSchema(status) ||
      status.headRefName !== head ||
      status.number !== number
    ) {
      throw new Error('Invalid or mismatched GitHub PR status response');
    }
    return status.isDraft;
  } catch (error) {
    throw new Error(
      `Could not confirm status of ${head} (PR #${number}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
