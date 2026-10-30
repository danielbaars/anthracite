import { TContext } from '../lib/context';
import { ExitFailedError } from '../lib/errors';
import {
  getGithubPr,
  inspectionGithubRepo,
  GithubPr,
} from '../lib/api/github_pr';
import {
  getGithubReviewUser,
  submitGithubReview,
  ReviewEvent,
  getGithubPrDiff,
} from '../lib/api/github_review';

export async function reviewPr(
  branch: string,
  context: TContext,
  action?: {
    readonly event: ReviewEvent;
    readonly body: string;
    readonly head: string;
  }
): Promise<void> {
  const pr = await getGithubPr(branch, context);
  if (!pr)
    throw new ExitFailedError(
      `Branch "${branch}" has no pull request to review.`
    );
  if (action) {
    if (pr.headRefOid !== action.head)
      throw new ExitFailedError(
        'Expected review head does not match the fresh PR head; inspect again.'
      );
    const user = await getGithubReviewUser();
    const fresh = await getGithubPr(branch, context);
    if (!sameSnapshot(pr, fresh))
      throw new ExitFailedError(
        'Pull request identity, base or head changed before review submission; inspect again.'
      );
    const review = await submitGithubReview(pr, inspectionGithubRepo(context), {
      event: action.event,
      body: action.body,
      user,
    });
    let current: GithubPr | undefined;
    try {
      current = await getGithubPr(branch, context);
    } catch {
      throw new ExitFailedError(
        `Review retained at ${review.html_url}, but current PR head is uncertain. Inspect before deliberate resubmission; do not automatically resubmit.`
      );
    }
    if (!sameSnapshot(pr, current))
      throw new ExitFailedError(
        `Review retained for ${
          current?.headRefOid !== review.commit_id ? 'older head' : 'head'
        } ${review.commit_id}: ${
          review.html_url
        }. PR identity, base or head changed; current-head success is unconfirmed. Inspect before deliberate resubmission; do not automatically resubmit.`
      );
    process.stdout.write(
      `Review ${review.id} ${review.state} by ${review.user.login} for head ${review.commit_id}: ${review.html_url}\n`
    );
    return;
  }
  const diff = await getGithubPrDiff(pr, inspectionGithubRepo(context));
  const fresh = await getGithubPr(branch, context);
  if (!sameSnapshot(pr, fresh))
    throw new ExitFailedError(
      'Pull request identity, base or head changed while retrieving the diff; inspect again.'
    );
  process.stdout.write(
    `PR #${pr.number}: ${pr.url}\nBase: ${pr.baseRefName} ${pr.baseRefOid}\nHead: ${pr.headRefName} ${pr.headRefOid}\n${diff}`
  );
}

function sameSnapshot(pr: GithubPr, fresh: GithubPr | undefined): boolean {
  return (
    fresh !== undefined &&
    pr.number === fresh.number &&
    pr.url === fresh.url &&
    pr.headRefName === fresh.headRefName &&
    pr.headRefOid === fresh.headRefOid &&
    pr.baseRefName === fresh.baseRefName &&
    pr.baseRefOid === fresh.baseRefOid
  );
}
