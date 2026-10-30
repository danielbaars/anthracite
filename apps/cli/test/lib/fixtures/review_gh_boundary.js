/* eslint-env node */
/* eslint-disable import/unambiguous, @typescript-eslint/no-var-requires */
const fs = require('fs');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const fail = (message) => {
  process.stderr.write(message);
  process.exitCode = 1;
};
if (args[0] !== 'api') {
  require(process.env.ANTHRACITE_TEST_REVIEW_FALLBACK);
} else {
  fs.appendFileSync(
    process.env.ANTHRACITE_TEST_PR_CALLS,
    JSON.stringify(args) + '\n'
  );
  const prs = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_PR_STATE, 'utf8')
  );
  const reviews = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_REVIEWS, 'utf8')
  );
  const endpoint = args[1];
  const pr = prs.find((item) =>
    endpoint.startsWith(`repos/fixture/inspection/pulls/${item.number}`)
  );
  const user = { id: 42, login: 'fixture-reviewer' };
  if (value('--hostname') !== 'github.com' || args.includes('--repo'))
    fail('wrong API hostname/repository syntax');
  else if (
    endpoint === 'user' &&
    value('--method') === 'GET' &&
    args.length === 8
  ) {
    process.stdout.write(JSON.stringify(user));
    if (process.env.ANTHRACITE_TEST_REVIEW_BEFORE_CHANGE) {
      prs[0][process.env.ANTHRACITE_TEST_REVIEW_BEFORE_CHANGE] = 'f'.repeat(40);
      fs.writeFileSync(
        process.env.ANTHRACITE_TEST_PR_STATE,
        JSON.stringify(prs)
      );
    }
  } else if (
    pr &&
    endpoint === `repos/fixture/inspection/pulls/${pr.number}` &&
    value('--method') === 'GET' &&
    value('--header') === 'Accept: application/vnd.github.diff' &&
    args.length === 8
  ) {
    process.stdout.write(
      execFileSync('git', ['diff', pr.baseRefOid, pr.headRefOid], {
        cwd: process.env.ANTHRACITE_TEST_REVIEW_REMOTE,
        encoding: 'utf8',
      })
    );
    if (process.env.ANTHRACITE_TEST_REVIEW_DIFF_CHANGE) {
      pr[process.env.ANTHRACITE_TEST_REVIEW_DIFF_CHANGE] = 'f'.repeat(40);
      fs.writeFileSync(
        process.env.ANTHRACITE_TEST_PR_STATE,
        JSON.stringify(prs)
      );
    }
  } else if (
    pr &&
    endpoint === `repos/fixture/inspection/pulls/${pr.number}/reviews` &&
    value('--method') === 'POST' &&
    value('--input') === '-' &&
    args.length === 10
  ) {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (
      Object.keys(payload).sort().join(',') !== 'body,commit_id,event' ||
      !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(payload.event) ||
      !/^[a-f0-9]{40}$/.test(payload.commit_id) ||
      typeof payload.body !== 'string'
    )
      fail('unsupported review request');
    else if (process.env.ANTHRACITE_TEST_REVIEW_REJECT)
      fail(process.env.ANTHRACITE_TEST_REVIEW_REJECT);
    else {
      const id = 101 + reviews.length;
      const review = {
        id,
        html_url: `${pr.url}#pullrequestreview-${id}`,
        pull_request_url: `https://api.github.com/repos/fixture/inspection/pulls/${pr.number}`,
        user,
        state: {
          APPROVE: 'APPROVED',
          REQUEST_CHANGES: 'CHANGES_REQUESTED',
          COMMENT: 'COMMENTED',
        }[payload.event],
        body: payload.body,
        commit_id: payload.commit_id,
      };
      reviews.push(review);
      fs.writeFileSync(
        process.env.ANTHRACITE_TEST_REVIEWS,
        JSON.stringify(reviews)
      );
      if (process.env.ANTHRACITE_TEST_REVIEW_AFTER_CHANGE) {
        pr[process.env.ANTHRACITE_TEST_REVIEW_AFTER_CHANGE] = 'e'.repeat(40);
        fs.writeFileSync(
          process.env.ANTHRACITE_TEST_PR_STATE,
          JSON.stringify(prs)
        );
      }
      if (process.env.ANTHRACITE_TEST_REVIEW_LOST_RESPONSE)
        fail('network timeout after acceptance');
      else process.stdout.write(JSON.stringify(review));
    }
  } else if (
    pr &&
    value('--method') === 'GET' &&
    args.length === 8 &&
    reviews.some(
      (review) =>
        endpoint ===
        `repos/fixture/inspection/pulls/${pr.number}/reviews/${review.id}`
    )
  ) {
    const readback = reviews.find((review) =>
      endpoint.endsWith(`/reviews/${review.id}`)
    );
    const replacement = process.env.ANTHRACITE_TEST_REVIEW_READBACK;
    if (replacement === 'malformed') process.stdout.write('{');
    else if (replacement === 'missing') process.stdout.write('null');
    else
      process.stdout.write(
        JSON.stringify({
          ...readback,
          ...(replacement ? JSON.parse(replacement) : {}),
        })
      );
  } else fail('unsupported review boundary: ' + JSON.stringify(args));
}
