import * as t from '@withgraphite/retype';
import { spiffy } from './spiffy';

export const prInfoConfigFactory = spiffy({
  schema: t.shape({
    prInfoToUpsert: t.array(
      t.shape({
        prNumber: t.number,
        title: t.string,
        body: t.string,
        state: t.literals(['OPEN', 'CLOSED', 'MERGED'] as const),
        reviewDecision: t.literals([
          'CHANGES_REQUESTED',
          'APPROVED',
          'REVIEW_REQUIRED',
          null,
          undefined,
        ] as const),
        headRefName: t.string,
        baseRefName: t.string,
        url: t.string,
        isDraft: t.boolean,
      })
    ),
  }),
  defaultLocations: [
    {
      relativePath: '.graphite_pr_info',
      relativeTo: 'REPO',
    },
  ],
  initialize: () => {
    return {
      message: undefined,
    };
  },
  helperFunctions: () => {
    return {};
  },
  options: { removeIfEmpty: true },
});
