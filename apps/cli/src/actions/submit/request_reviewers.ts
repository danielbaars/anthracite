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

function hasReviewRequest(
  state: ReviewState,
  reviewer: string,
  repo: string
): boolean {
  const name = reviewer.toLowerCase();
  return state.reviewRequests.some(
    (request) =>
      request.login?.toLowerCase() === name ||
      (name.includes('/') &&
        name.split('/')[0] === repo.split('/')[0].toLowerCase() &&
        request.slug?.toLowerCase() === name.split('/')[1])
  );
}

function readReviewState(target: ReviewTarget): ReviewState {
  const value: unknown = JSON.parse(
    execFileSync(
      'gh',
      [
        'pr',
        'view',
        String(target.number),
        '--repo',
        target.repo,
        '--json',
        'headRefName,number,reviewRequests,reviews',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString()
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
  const names = [
    ...new Map(reviewers.map((name) => [name.toLowerCase(), name])).values(),
  ];
  const additions = names.filter(
    (name) => !hasReviewRequest(before, name, target.repo)
  );
  if (!additions.length) return;
  assertBranchEditable(target.head);
  let failure: unknown;
  try {
    execFileSync(
      'gh',
      [
        'pr',
        'edit',
        String(target.number),
        '--repo',
        target.repo,
        ...additions.flatMap((reviewer) => ['--add-reviewer', reviewer]),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    failure = error;
  }
  let after: ReviewState;
  try {
    after = readReviewState(target);
  } catch (error) {
    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }. Unverified reviewers: ${additions.join(
        ', '
      )}. Confirmed reviewers before update: ${
        names
          .filter((name) => hasReviewRequest(before, name, target.repo))
          .join(', ') || 'none'
      }`
    );
  }
  const oldReviewIds = new Set(before.reviews.map((review) => review.id));
  const missing = names.filter((reviewer) => {
    const name = reviewer.toLowerCase();
    const requested = hasReviewRequest(after, reviewer, target.repo);
    const newlyReviewed = after.reviews.some(
      (review) =>
        review.author?.login.toLowerCase() === name &&
        !oldReviewIds.has(review.id)
    );
    return !requested && !newlyReviewed;
  });
  if (missing.length || failure !== undefined) {
    const confirmed = names.filter((reviewer) => !missing.includes(reviewer));
    throw new Error(
      `Review request ${
        failure !== undefined ? 'failed' : 'not confirmed'
      } for ${missing.join(', ') || additions.join(', ')} on ${
        target.head
      }. Confirmed reviewers: ${confirmed.join(', ') || 'none'}${
        failure !== undefined
          ? `. ${failure instanceof Error ? failure.message : String(failure)}`
          : ''
      }`
    );
  }
}
