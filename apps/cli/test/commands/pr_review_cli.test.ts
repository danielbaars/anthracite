import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { preparePrInspection, PrFixture } from '../lib/fixtures/pr_gh';

// eslint-disable-next-line max-lines-per-function
describe('public head-bound GitHub review', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: PrFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = preparePrInspection(fixture);
    fixture.env.ANTHRACITE_TEST_REVIEW_FALLBACK = path.join(
      __dirname,
      '../lib/fixtures/pr_gh_boundary.js'
    );
    fixture.env.ANTHRACITE_TEST_REVIEW_REMOTE = github.remote;
    fixture.env.ANTHRACITE_TEST_REVIEWS = path.join(
      fixture.root,
      'reviews.json'
    );
    fs.writeFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS, '[]');
    fs.writeFileSync(
      path.join(github.bin, 'gh'),
      `#!${process.execPath}\n${fs.readFileSync(
        path.join(__dirname, '../lib/fixtures/review_gh_boundary.js'),
        'utf8'
      )}`,
      { mode: 0o755 }
    );
  });
  afterEach(() => {
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence && github) {
      const destination = path.join(evidence, path.basename(fixture.root));
      fs.mkdirSync(destination, { recursive: true });
      for (const file of [
        github.state,
        github.calls,
        github.browser,
        fixture.env.ANTHRACITE_TEST_REVIEWS,
      ])
        if (file)
          fs.copyFileSync(file, path.join(destination, path.basename(file)));
    }
    fixture?.cleanup();
  });

  it('displays only the actual selected base-to-head diff while preserving dirty local work', () => {
    const pr = github.pr('tip', 19);
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nLOCAL STAGED');
    fixture.git(['add', 'base.txt']);
    fs.appendFileSync(path.join(fixture.repo, 'base.txt'), '\nLOCAL UNSTAGED');
    fs.writeFileSync(path.join(fixture.repo, 'untracked'), 'LOCAL UNTRACKED');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'review',
      'tip',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include(String(pr.baseRefOid))
      .and.include(String(pr.headRefOid))
      .and.include('diff --git a/tip.txt b/tip.txt');
    expect(result.stdout).not.to.include('a/child.txt');
    expect(result.stdout).not.to.include('LOCAL');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
  });

  it('refuses a moving base or head without printing an unstable diff', () => {
    for (const field of ['headRefOid', 'baseRefOid']) {
      fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
      fixture.env.ANTHRACITE_TEST_REVIEW_DIFF_CHANGE = field;
      const result = fixture.run(['review', '--no-interactive']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('changed');
      expect(result.stdout).not.to.include('diff --git');
    }
  });

  it('submits one explicit approval to its full expected head and confirms the authenticated review', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr, github.pr('tip', 19)]));
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'review',
      '--approve',
      '--head',
      String(pr.headRefOid),
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('APPROVED')
      .and.include(String(pr.headRefOid))
      .and.include('fixture-reviewer')
      .and.include('/pull/17#pullrequestreview-101');
    const reviews = JSON.parse(
      fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
    );
    expect(reviews).to.have.length(1);
    expect(reviews[0]).to.include({
      state: 'APPROVED',
      commit_id: pr.headRefOid,
      body: '',
    });
    expect(reviews[0].user.login).to.equal('fixture-reviewer');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves literal multiline Markdown and shell text in comment and changes-requested reviews', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const body = '# Review\n\n`$(touch escaped)` $HOME ; "quoted"\n';
    const file = path.join(fixture.root, 'review.md');
    fs.writeFileSync(file, body);
    for (const [action, source, value, state] of [
      ['--comment', '--body', body, 'COMMENTED'],
      ['--request-changes', '--body-file', file, 'CHANGES_REQUESTED'],
    ]) {
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'review',
        'base',
        action,
        '--head',
        String(pr.headRefOid),
        source,
        value,
        '--no-interactive',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include(state);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    const reviews = JSON.parse(
      fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
    );
    expect(
      reviews.map((review: { body: string }) => review.body)
    ).to.deep.equal([body, body]);
    expect(
      reviews.map((review: { state: string }) => review.state)
    ).to.deep.equal(['COMMENTED', 'CHANGES_REQUESTED']);
    expect(fs.existsSync(path.join(fixture.repo, 'escaped'))).to.equal(false);
  });

  it('rejects invalid action, expected-head and body input before any external write', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const head = ['--head', String(pr.headRefOid)];
    const invalidUtf8 = path.join(fixture.root, 'invalid-utf8');
    fs.writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe]));
    const invalid = [
      ['--approve'],
      ['--approve', '--head', 'short'],
      ['--approve', '--head', 'f'.repeat(40)],
      ['--head', String(pr.headRefOid)],
      ['--body', 'text'],
      ['--body-file', invalidUtf8],
      ['--approve', '--comment', ...head],
      ['--request-changes', '--approve', ...head],
      ['--comment', '--request-changes', ...head],
      ['--comment', ...head],
      ['--request-changes', ...head, '--body', ' \n '],
      ['--comment', ...head, '--body', 'x', '--body-file', invalidUtf8],
      ['--comment', ...head, '--body-file', '-'],
      ['--comment', ...head, '--body-file', ''],
      ['--comment', ...head, '--body-file', path.join(fixture.root, 'missing')],
      ['--comment', ...head, '--body-file', invalidUtf8],
      ['--comment', ...head, '--body', 'one', '--body', 'two'],
      ['--approve', ...head, '--head', String(pr.headRefOid)],
      ['--approve', ...head, '--no-body'],
      ['--approve=wat', ...head],
      ['--unknown'],
      ['base', 'child'],
      ['--branch', 'base'],
      [''],
    ];
    const before = fixture.inspectionSnapshot();
    for (const args of invalid) {
      const result = fixture.run(['review', ...args, '--no-interactive']);
      expect(
        result.status,
        JSON.stringify(args) + result.stdout + result.stderr
      ).to.equal(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(
      JSON.parse(
        fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
      )
    ).to.deep.equal([]);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"POST"');
  });

  it('rejects a PR snapshot that moves before submission without creating a review', () => {
    for (const field of ['headRefOid', 'baseRefOid']) {
      const pr = github.pr('base');
      fs.writeFileSync(github.state, JSON.stringify([pr]));
      fixture.env.ANTHRACITE_TEST_REVIEW_BEFORE_CHANGE = field;
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'review',
        '--approve',
        '--head',
        String(pr.headRefOid),
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('changed before review submission');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(
      JSON.parse(
        fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
      )
    ).to.deep.equal([]);
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"POST"');
  });

  it('retains an accepted older-head review and refuses current-head success without replacing it', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fixture.env.ANTHRACITE_TEST_REVIEW_AFTER_CHANGE = 'headRefOid';
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'review',
      '--approve',
      '--head',
      String(pr.headRefOid),
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('retained for older head')
      .and.include('/pull/17#pullrequestreview-101')
      .and.include(String(pr.headRefOid))
      .and.include('do not automatically resubmit');
    expect(result.stdout).to.equal('');
    const reviews = JSON.parse(
      fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
    );
    expect(reviews).to.have.length(1);
    expect(reviews[0]).to.include({
      state: 'APPROVED',
      commit_id: pr.headRefOid,
    });
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('reports an accepted but lost response as uncertain and never duplicates its POST', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fixture.env.ANTHRACITE_TEST_REVIEW_LOST_RESPONSE = '1';
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'review',
      '--comment',
      '--body',
      'Keep exactly one',
      '--head',
      String(pr.headRefOid),
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr)
      .to.include('uncertain')
      .and.include('network')
      .and.include('Do not automatically resubmit')
      .and.include('https://github.com/fixture/inspection/pull/17')
      .and.include('repos/fixture/inspection/pulls/17/reviews');
    const reviews = JSON.parse(
      fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
    );
    expect(reviews).to.have.length(1);
    expect(reviews[0]).to.include({
      body: 'Keep exactly one',
      state: 'COMMENTED',
    });
    expect(
      fs
        .readFileSync(github.calls, 'utf8')
        .split('\n')
        .filter((line) => line.includes('"POST"'))
    ).to.have.length(1);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('keeps wrong or unavailable review readback unverified without issuing another review', () => {
    const pr = github.pr('base');
    const invalid = [
      'missing',
      'malformed',
      JSON.stringify({ id: 999 }),
      JSON.stringify({ user: { id: 99, login: 'someone-else' } }),
      JSON.stringify({ state: 'CHANGES_REQUESTED' }),
      JSON.stringify({ body: 'wrong' }),
      JSON.stringify({ commit_id: 'd'.repeat(40) }),
      JSON.stringify({
        html_url:
          'https://github.com/fixture/inspection/pull/19#pullrequestreview-101',
      }),
      JSON.stringify({
        pull_request_url: 'https://api.github.com/repos/wrong/repo/pulls/17',
      }),
    ];
    for (const readback of invalid) {
      fs.writeFileSync(github.state, JSON.stringify([pr]));
      fs.writeFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', '[]');
      fs.writeFileSync(github.calls, '');
      fixture.env.ANTHRACITE_TEST_REVIEW_READBACK = readback;
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'review',
        '--approve',
        '--head',
        String(pr.headRefOid),
        '--quiet',
        '--no-interactive',
      ]);
      expect(result.status, readback + result.stdout + result.stderr).to.equal(
        1
      );
      expect(result.stdout).to.equal('');
      expect(result.stderr)
        .to.include('retained but unverified')
        .and.include('/pull/17#pullrequestreview-101')
        .and.include('Do not automatically resubmit');
      expect(
        JSON.parse(
          fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
        )
      ).to.have.length(1);
      expect(
        fs
          .readFileSync(github.calls, 'utf8')
          .split('\n')
          .filter((line) => line.includes('"POST"'))
      ).to.have.length(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
  });

  it('surfaces GitHub eligibility and permission rejection without changing PRs or local work', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const before = fixture.inspectionSnapshot();
    for (const reason of [
      'HTTP 422: Can not approve your own pull request',
      'HTTP 403: Resource not accessible by integration',
    ]) {
      fixture.env.ANTHRACITE_TEST_REVIEW_REJECT = reason;
      const result = fixture.run([
        'review',
        '--approve',
        '--head',
        String(pr.headRefOid),
        '--no-interactive',
      ]);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include(reason);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(
        JSON.parse(
          fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
        )
      ).to.deep.equal([]);
    }
  });

  it('preserves a UTF-8 body file byte-for-text including its leading BOM', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const body = '\ufeff# Literal UTF-8\r\n\r\nRésumé ☕\r\n';
    const file = path.join(fixture.root, 'utf8-body.md');
    fs.writeFileSync(file, body);
    const result = fixture.run([
      'review',
      '--comment',
      '--head',
      String(pr.headRefOid),
      '--body-file',
      file,
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const reviews = JSON.parse(
      fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
    );
    expect(reviews[0].body).to.equal(body);
  });

  it('provides public review help, literal branch completion and normal cwd selection', () => {
    const help = fixture.run(['review', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    for (const option of [
      'review [branch]',
      '--approve',
      '--request-changes',
      '--comment',
      '--body',
      '--body-file',
      '--head',
    ])
      expect(help.stdout).to.include(option);
    const completion = fixture.run([
      '--get-yargs-completions',
      'an',
      'review',
      '',
    ]);
    expect(completion.status, completion.stderr).to.equal(0);
    expect(completion.stdout.split('\n'))
      .to.include('base')
      .and.include('child');
    fixture.branch('123', 'main');
    fixture.branch('topic;$()&`literal`', 'main');
    fixture.git(['push', github.remote, '--all']);
    const names = ['123', 'topic;$()&`literal`'];
    fs.writeFileSync(
      github.state,
      JSON.stringify(names.map((name, index) => github.pr(name, 30 + index)))
    );
    const directory = path.join(fixture.repo, 'sub');
    fs.mkdirSync(directory);
    const before = fixture.inspectionSnapshot();
    for (const name of names) {
      const result = fixture.run(
        ['--cwd', directory, 'review', name, '--quiet', '--no-interactive'],
        fixture.root
      );
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include(`Head: ${name} `);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('preserves damaged caches and saved recovery while selecting physical HEAD for reads and writes', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_persist'),
      Buffer.from([0, 255, 13])
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      JSON.stringify({
        branchesToSync: [],
        branchesToRestack: [],
        currentBranchOverride: 'other',
      })
    );
    const before = fixture.inspectionSnapshot();
    const inspect = fixture.run(['review', '--no-interactive']);
    expect(inspect.status, inspect.stdout + inspect.stderr).to.equal(0);
    expect(inspect.stdout).to.include('Head: base ');
    const action = fixture.run([
      'review',
      '--comment',
      '--body',
      'Preserve recovery',
      '--head',
      String(pr.headRefOid),
      '--no-interactive',
    ]);
    expect(action.status, action.stdout + action.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['checkout', '--detach']);
    const detached = fixture.inspectionSnapshot();
    const implicit = fixture.run(['review', '--no-interactive']);
    expect(implicit.status).to.equal(1);
    expect(implicit.stderr).to.include('without a branch checked out');
    const explicit = fixture.run(['review', 'base', '--no-interactive']);
    expect(explicit.status, explicit.stdout + explicit.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(detached);
  });

  it('permits explicit review reads and a single review during real detached conflict recovery without touching it', () => {
    fixture.branch('conflict-base', 'main', true);
    const file = path.join(fixture.repo, 'main.txt');
    const change = (text: string): void => {
      fs.writeFileSync(file, text);
      fixture.git(['add', 'main.txt']);
      fixture.git(['commit', '-m', text]);
    };
    change('base own');
    fixture.branch('conflict-child', 'conflict-base', true);
    change('child own');
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
    const conflict = fixture.run(['reorder', '--stack', '--interactive']);
    expect(conflict.status).to.equal(1);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const before = fixture.inspectionSnapshot();
    const inspect = fixture.run(['review', 'base', '--no-interactive']);
    expect(inspect.status, inspect.stdout + inspect.stderr).to.equal(0);
    const action = fixture.run([
      'review',
      'base',
      '--comment',
      '--body',
      'Independent PR review',
      '--head',
      String(pr.headRefOid),
      '--no-interactive',
    ]);
    expect(action.status, action.stdout + action.stderr).to.equal(0);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('reports a changed base after submission without falsely calling its unchanged review head old', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fixture.env.ANTHRACITE_TEST_REVIEW_AFTER_CHANGE = 'baseRefOid';
    const result = fixture.run([
      'review',
      '--approve',
      '--head',
      String(pr.headRefOid),
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr)
      .to.include('retained')
      .and.include('base')
      .and.include(String(pr.headRefOid));
    expect(result.stderr).not.to.include('older head');
    expect(
      JSON.parse(
        fs.readFileSync(fixture.env.ANTHRACITE_TEST_REVIEWS ?? '', 'utf8')
      )
    ).to.have.length(1);
  });
});
