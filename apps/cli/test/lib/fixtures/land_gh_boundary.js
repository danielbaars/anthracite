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
    if (
      input.sha !==
      (
        progress.merges[progress.index || 0].reached ||
        progress.merges[progress.index || 0]
      ).head
    )
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
        if (policy.replayConflict) {
          fs.writeFileSync(
            path.join(cwd, 'child.txt'),
            'concurrent trunk change\n'
          );
          git(['add', 'child.txt'], cwd);
          git(['commit', '-m', 'Concurrent trunk change'], cwd);
        }
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
  else if (endpoint.startsWith(prefix + '/commits/')) {
    const match = endpoint.match(
      /^repos\/fixture\/inspection\/commits\/([a-f0-9]{40})\/check-runs\?per_page=100&page=([1-9][0-9]*)&filter=latest$/
    );
    if (!match || !Array.isArray(policy.checkRuns))
      throw new Error('unsupported check-run request');
    const page = Number(match[2]);
    if (
      policy.failCheckRunsRead &&
      fs
        .readFileSync(process.env.ANTHRACITE_TEST_PR_CALLS, 'utf8')
        .split('\n')
        .filter((line) => line.includes('/check-runs?')).length >=
        policy.failCheckRunsRead
    )
      throw new Error('injected later check-run read failure');
    if (policy.failCheckRunsPage === page)
      throw new Error('injected check-run read failure');
    process.stdout.write(
      JSON.stringify({
        total_count: policy.checkRunsTotal ?? policy.checkRuns.length,
        check_runs: policy.checkRuns.slice((page - 1) * 100, page * 100),
      })
    );
  } else if (endpoint.startsWith(prefix + '/pulls/')) {
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

if (
  args[0] === 'pr' &&
  ['list', 'view', 'edit'].includes(args[1]) &&
  !args.includes('--web')
) {
  const fs = require('fs');
  const cp = require('child_process');
  const file = process.env.ANTHRACITE_TEST_PR_STATE;
  const policy = JSON.parse(
    fs.readFileSync(process.env.ANTHRACITE_TEST_LAND_POLICY, 'utf8')
  );
  const prs = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  const save = () => {
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(prs));
    fs.renameSync(temporary, file);
  };
  const observedFile = process.env.ANTHRACITE_TEST_LAND_OBSERVED;
  const previous = JSON.parse(fs.readFileSync(observedFile, 'utf8'));
  const actual = Object.fromEntries(
    cp
      .execFileSync(
        'git',
        [
          '--git-dir=' + process.env.ANTHRACITE_TEST_LAND_REMOTE,
          'for-each-ref',
          '--format=%(refname:short) %(objectname)',
          'refs/heads',
        ],
        { encoding: 'utf8' }
      )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' '))
  );
  for (const pr of prs.filter((item) => item.state === 'OPEN')) {
    const revision = (branch) => actual[branch];
    const head = revision(pr.headRefName);
    if (head && previous[pr.headRefName] && head !== previous[pr.headRefName]) {
      changed = true;
      pr.headRefOid = head;
      if (policy.dismissAfterPush) pr.reviewDecision = 'REVIEW_REQUIRED';
      if (policy.pendingAfterPush)
        pr.statusCheckRollup = [
          {
            __typename: 'CheckRun',
            name: 'unit',
            status: 'IN_PROGRESS',
            conclusion: null,
          },
        ];
    }
    const base = revision(pr.baseRefName);
    if (base && previous[pr.baseRefName] && base !== previous[pr.baseRefName]) {
      changed = true;
      pr.baseRefOid = base;
    }
  }
  if (changed) save();
  if (JSON.stringify(previous) !== JSON.stringify(actual)) {
    const temporary = observedFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(actual));
    fs.renameSync(temporary, observedFile);
  }
  if (args[1] === 'edit') {
    fs.appendFileSync(
      process.env.ANTHRACITE_TEST_PR_CALLS,
      JSON.stringify(args) + '\n'
    );
    if (
      args.length !== 9 ||
      args[3] !== '--base' ||
      args[5] !== '--body' ||
      args[7] !== '--repo' ||
      args[8] !== 'github.com/fixture/inspection'
    )
      throw new Error('unsupported landing PR edit');
    const pr = prs.find((item) => String(item.number) === args[2]);
    if (!pr || pr.state !== 'OPEN')
      throw new Error('PR edit identity mismatch');
    if (policy.failPrEdit) throw new Error('injected PR update failure');
    pr.baseRefName = args[4];
    pr.body = args[6];
    pr.baseRefOid = cp
      .execFileSync(
        'git',
        [
          '--git-dir=' + process.env.ANTHRACITE_TEST_LAND_REMOTE,
          'rev-parse',
          'refs/heads/' + args[4],
        ],
        { encoding: 'utf8' }
      )
      .trim();
    save();
  }
}
