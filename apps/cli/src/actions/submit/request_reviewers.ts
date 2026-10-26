import { execFileSync } from 'child_process';
import * as t from '@withgraphite/retype';
import { assertBranchEditable } from '../../lib/engine/frozen_branch';

const reviewStateSchema = t.shape({
  headRefName: t.string,
  number: t.number,
  reviewRequests: t.array(
    t.shape({ login: t.optional(t.string), slug: t.optional(t.string) })
  ),
  reviews: t.array(
    t.shape({
      id: t.string,
      author: t.unionMany([t.literal(null), t.shape({ login: t.string })]),
    })
  ),
});

type ReviewState = t.TypeOf<typeof reviewStateSchema>;

type ReviewTarget = {
  head: string;
  number: number;
  repo: string;
};

function readReviewState(target: ReviewTarget): ReviewState {
  const value: unknown = JSON.parse(
    execFileSync('gh', [
      'pr',
      'view',
      String(target.number),
      '--repo',
      target.repo,
      '--json',
      'headRefName,number,reviewRequests,reviews',
    ]).toString()
  );
  if (
    !reviewStateSchema(value) ||
    value.headRefName !== target.head ||
    value.number !== target.number
  ) {
    throw new Error(
      `Could not verify reviewers for ${target.head}: invalid PR response`
    );
  }
  return value;
}

export function requestReviewers(
  target: ReviewTarget,
  reviewers: readonly string[]
): void {
  if (!reviewers.length) return;
  const before = readReviewState(target);
  assertBranchEditable(target.head);
  execFileSync('gh', [
    'pr',
    'edit',
    String(target.number),
    '--repo',
    target.repo,
    ...reviewers.flatMap((reviewer) => ['--add-reviewer', reviewer]),
  ]);
  const after = readReviewState(target);
  const oldReviewIds = new Set(before.reviews.map((review) => review.id));
  const missing = reviewers.filter((reviewer) => {
    const name = reviewer.toLowerCase();
    const requested = after.reviewRequests.some(
      (request) =>
        request.login?.toLowerCase() === name ||
        (name.includes('/') &&
          name.split('/')[0] === target.repo.split('/')[0].toLowerCase() &&
          request.slug?.toLowerCase() === name.split('/')[1])
    );
    const newlyReviewed = after.reviews.some(
      (review) =>
        review.author?.login.toLowerCase() === name &&
        !oldReviewIds.has(review.id)
    );
    return !requested && !newlyReviewed;
  });
  if (missing.length) {
    const confirmed = reviewers.filter(
      (reviewer) => !missing.includes(reviewer)
    );
    throw new Error(
      `Review request not confirmed for ${missing.join(', ')} on ${
        target.head
      }. Confirmed reviewers: ${confirmed.join(', ') || 'none'}`
    );
  }
}
