/* eslint-env node */
/* eslint-disable import/unambiguous, @typescript-eslint/no-var-requires */
// External boundary fixture: unsupported requests fail closed.
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.ANTHRACITE_TEST_PR_CALLS,
  JSON.stringify(args) + '\n'
);
const fail = (message) => {
  process.stderr.write(message + '\n');
  process.exitCode = 1;
};
const value = (flag) => args[args.indexOf(flag) + 1];
const fields = [
  'number',
  'url',
  'title',
  'body',
  'author',
  'state',
  'isDraft',
  'headRefName',
  'headRefOid',
  'baseRefName',
  'baseRefOid',
  'headRepository',
  'headRepositoryOwner',
  'isCrossRepository',
  'reviewDecision',
  'mergeable',
  'mergeStateStatus',
  'statusCheckRollup',
];
if (
  args.includes('--json') &&
  !value('--json')
    .split(',')
    .every((field) => fields.includes(field))
) {
  fail('unsupported PR fields');
} else if (value('--repo') !== 'github.com/fixture/inspection') {
  fail('wrong configured repository');
} else if (
  args[0] === 'pr' &&
  args[1] === 'list' &&
  args.length === 12 &&
  args.includes('--json') &&
  value('--state') === 'all' &&
  value('--limit') === '100'
) {
  const prs = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_PR_STATE, 'utf8')
  );
  process.stdout.write(
    JSON.stringify(prs.filter((pr) => pr.headRefName === value('--head')))
  );
} else if (
  args[0] === 'pr' &&
  args[1] === 'view' &&
  args.length === 7 &&
  args.includes('--json')
) {
  const prs = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_PR_STATE, 'utf8')
  );
  const pr = prs.find((pr) => String(pr.number) === args[2]);
  if (pr) process.stdout.write(JSON.stringify(pr));
  else fail('GraphQL: Could not resolve to a PullRequest');
} else if (
  args[0] === 'pr' &&
  args[1] === 'view' &&
  args.length === 6 &&
  args.includes('--web') &&
  /^https:\/\/github.com\/fixture\/inspection\/pull\/[1-9][0-9]*$/.test(args[2])
) {
  fs.appendFileSync(
    process.env.ANTHRACITE_TEST_PR_BROWSER,
    JSON.stringify(args[2]) + '\n'
  );
} else fail('unsupported gh boundary: ' + JSON.stringify(args));
