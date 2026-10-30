/* eslint-env node */
/* eslint-disable import/unambiguous, @typescript-eslint/no-var-requires */
const args = process.argv.slice(2);
if (args[0] === 'api') {
  const fs = require('fs');
  fs.appendFileSync(
    process.env.ANTHRACITE_TEST_PR_CALLS,
    JSON.stringify(args) + '\n'
  );
  const policy = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_LAND_POLICY, 'utf8')
  );
  const endpoint = args[1];
  const prefix = 'repos/fixture/inspection';
  if (
    args.includes('--repo') ||
    !args.includes('--hostname') ||
    args[args.indexOf('--hostname') + 1] !== 'github.com'
  )
    throw new Error('incorrect API host scope');
  if (policy.unavailable) {
    process.stderr.write('HTTP 403: unavailable policy');
    process.exitCode = 1;
  } else if (endpoint === prefix)
    process.stdout.write(
      JSON.stringify({
        full_name: 'fixture/inspection',
        allow_rebase_merge: policy.allow_rebase_merge,
      })
    );
  else if (endpoint === prefix + '/branches/main')
    process.stdout.write(
      JSON.stringify({ name: 'main', protected: policy.protected })
    );
  else if (
    endpoint.startsWith(prefix + '/rules/branches/main?per_page=100&page=')
  ) {
    const page = Number(endpoint.split('page=').pop());
    process.stdout.write(
      JSON.stringify(policy.rules.slice((page - 1) * 100, page * 100))
    );
  } else if (
    endpoint === prefix + '/branches/main/protection' &&
    policy.protection
  )
    process.stdout.write(JSON.stringify(policy.protection));
  else if (endpoint.startsWith(prefix + '/pulls/')) {
    const prs = JSON.parse(
      fs.readFileSync(process.env.ANTHRACITE_TEST_PR_STATE, 'utf8')
    );
    const pr = prs.find(
      (value) => String(value.number) === endpoint.split('/').pop()
    );
    if (!pr || !pr.mergeResult) throw new Error('missing merged result');
    process.stdout.write(
      JSON.stringify({
        number: pr.number,
        merged: pr.state === 'MERGED',
        merge_commit_sha: pr.mergeResult,
        head: { ref: pr.headRefName, sha: pr.headRefOid },
        base: { ref: 'main', repo: { full_name: 'fixture/inspection' } },
      })
    );
  } else {
    process.stderr.write('HTTP 404: Not Found');
    process.exitCode = 1;
  }
}
