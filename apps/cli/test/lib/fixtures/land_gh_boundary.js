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
  const method = args[args.indexOf('--method') + 1];
  if (
    method !== 'GET' &&
    !(
      method === 'PUT' &&
      /^repos\/fixture\/inspection\/pulls\/[1-9][0-9]*\/merge$/.test(endpoint)
    )
  )
    throw new Error('unsupported method/endpoint');
  if (method === 'PUT') {
    const cp = require('child_process');
    const path = require('path');
    const os = require('os');
    if (args.length !== 8 || args[args.indexOf('--input') + 1] !== '-')
      throw new Error('invalid merge arguments');
    const common = cp
      .execFileSync('git', ['rev-parse', '--git-common-dir'], {
        encoding: 'utf8',
      })
      .trim();
    const progress = JSON.parse(
      fs.readFileSync(path.resolve(common, '.anthracite_landing'), 'utf8')
    );
    if (
      progress.owner !== 'anthracite-landing' ||
      progress.phase !== 'merge-requested'
    )
      throw new Error('durable intent missing before merge');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (input.sha !== progress.merges[0].head)
      throw new Error('expected head not retained');
    if (
      Object.keys(input).sort().join(',') !== 'merge_method,sha' ||
      input.merge_method !== 'rebase'
    )
      throw new Error('invalid merge input');
    const remote = process.env.ANTHRACITE_TEST_LAND_REMOTE;
    const state = process.env.ANTHRACITE_TEST_PR_STATE;
    const prs = JSON.parse(fs.readFileSync(state, 'utf8'));
    const pr = prs.find(
      (value) => String(value.number) === endpoint.split('/').slice(-2)[0]
    );
    if (policy.moveHeadBeforeMerge && pr) {
      const git = (values) =>
        cp
          .execFileSync('git', ['--git-dir=' + remote, ...values], {
            encoding: 'utf8',
          })
          .trim();
      const tree = git(['rev-parse', pr.headRefOid + '^{tree}']);
      const changed = git([
        '-c',
        'user.name=Concurrent',
        '-c',
        'user.email=concurrent@example.test',
        'commit-tree',
        tree,
        '-p',
        pr.headRefOid,
        '-m',
        'New remote head before merge',
      ]);
      git([
        'update-ref',
        'refs/heads/' + pr.headRefName,
        changed,
        pr.headRefOid,
      ]);
      pr.headRefOid = changed;
      fs.writeFileSync(state, JSON.stringify(prs));
    }
    if (
      !pr ||
      pr.state !== 'OPEN' ||
      input.sha !== pr.headRefOid ||
      pr.baseRefName !== 'main'
    )
      throw new Error('merge identity mismatch');
    if (
      cp
        .execFileSync(
          'git',
          ['--git-dir=' + remote, 'rev-parse', 'refs/heads/' + pr.headRefName],
          { encoding: 'utf8' }
        )
        .trim() !== input.sha
    )
      throw new Error('HTTP 409 expected head mismatch');
    if (policy.queuedResponse) {
      process.stdout.write(
        JSON.stringify({ merged: false, sha: input.sha, message: 'queued' })
      );
    } else {
      const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), 'an-merge-adapter-')
      );
      const env = {
        ...process.env,
        GIT_COMMITTER_DATE: '2035-01-01T00:00:00Z',
      };
      for (const key of [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_CONFIG_PARAMETERS',
      ])
        delete env[key];
      const git = (values, cwd = temporary) =>
        cp
          .execFileSync('git', values, {
            cwd,
            env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          .trim();
      try {
        git(['clone', '--no-checkout', remote, 'merge']);
        const cwd = path.join(temporary, 'merge');
        git(['config', 'user.name', 'GitHub fixture'], cwd);
        git(['config', 'user.email', 'merge@example.test'], cwd);
        git(['checkout', '-B', 'landing', pr.headRefOid], cwd);
        git(
          [
            'rebase',
            '--force-rebase',
            '--onto',
            'origin/main',
            pr.baseRefOid,
            'landing',
          ],
          cwd
        );
        const result = git(['rev-parse', 'HEAD'], cwd);
        if (result === pr.headRefOid)
          throw new Error('fixture failed to produce distinct rebase OID');
        git(['push', 'origin', 'HEAD:refs/heads/main'], cwd);
        pr.state = 'MERGED';
        pr.mergeResult = result;
        fs.writeFileSync(state, JSON.stringify(prs));
        if (policy.interruptAfterMerge) process.kill(process.ppid, 'SIGTERM');
        if (policy.autoDelete)
          git(['update-ref', '-d', 'refs/heads/' + pr.headRefName], remote);
        if (policy.loseMergeResponse) {
          process.stderr.write('network: accepted merge response lost');
          process.exitCode = 1;
        } else
          process.stdout.write(JSON.stringify({ merged: true, sha: result }));
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  } else if (policy.unavailable) {
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
    if (!pr) throw new Error('missing PR');
    process.stdout.write(
      JSON.stringify({
        number: pr.number,
        merged: pr.state === 'MERGED',
        state: pr.state === 'OPEN' ? 'open' : 'closed',
        merge_commit_sha: pr.mergeResult || null,
        head: {
          ref: pr.headRefName,
          sha: pr.headRefOid,
          repo: { full_name: 'fixture/inspection' },
        },
        base: { ref: 'main', repo: { full_name: 'fixture/inspection' } },
      })
    );
  } else {
    process.stderr.write('HTTP 404: Not Found');
    process.exitCode = 1;
  }
}
