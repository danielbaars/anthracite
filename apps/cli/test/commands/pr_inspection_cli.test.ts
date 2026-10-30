import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { preparePrInspection, PrFixture } from '../lib/fixtures/pr_gh';

// eslint-disable-next-line max-lines-per-function
describe('public GitHub PR inspection', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: PrFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = preparePrInspection(fixture);
  });
  afterEach(() => fixture?.cleanup());

  it('shows fresh complete configured-repository identity without changing local or remote state', () => {
    const pr = github.pr('base');
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('fixture/inspection')
      .and.include('base')
      .and.include('#17')
      .and.include('https://github.com/fixture/inspection/pull/17')
      .and.include('PR for base')
      .and.include('reviewer')
      .and.include('OPEN')
      .and.include('Draft: false')
      .and.include('Base: main')
      .and.include(String(pr.headRefOid))
      .and.include('APPROVED')
      .and.include('unit')
      .and.include('SUCCESS')
      .and.include('CLEAN');
    expect(result.stderr).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
  });

  it('shows the complete connected fanout and opens only the selected PR when explicitly requested', () => {
    fixture.branch('sibling', 'base');
    fixture.git(['switch', 'tip']);
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        github.pr('base', 17),
        github.pr('tip', 19),
        github.pr('sibling', 20),
        github.pr('other', 21),
      ])
    );
    fixture.git(['switch', 'other']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'pr',
      'tip',
      '--stack',
      '--web',
      '--quiet',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Branch: base')
      .and.include('Branch: child')
      .and.include('No pull request.')
      .and.include('Branch: tip')
      .and.include('Branch: sibling');
    expect(result.stdout).not.to.include('Branch: other');
    expect(fs.readFileSync(github.browser, 'utf8')).to.equal(
      '"https://github.com/fixture/inspection/pull/19"\n'
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('provides help and literal branch completion and rejects invalid selectors before inspection', () => {
    const help = fixture.run(['pr', '--help'], fixture.root);
    expect(help.status, help.stderr).to.equal(0);
    expect(help.stdout)
      .to.include('pr [branch]')
      .and.include('--stack')
      .and.include('--web');
    const before = fixture.inspectionSnapshot();
    const completion = fixture.run(['--get-yargs-completions', 'an', 'pr', '']);
    expect(completion.status, completion.stderr).to.equal(0);
    expect(completion.stdout.split('\n')).to.include('base').and.include('tip');
    for (const args of [
      ['base', 'child'],
      [''],
      ['--branch', 'base'],
      ['--branch=base'],
      ['--stack=maybe'],
      ['--web=maybe'],
      ['--unknown'],
      ['--all'],
      ['main'],
      ['unknown'],
    ]) {
      const result = fixture.run(['pr', ...args, '--no-interactive']);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(result.stdout, args.join(' ')).to.equal('');
      expect(result.stderr, args.join(' ')).not.to.equal('');
      expect(fixture.inspectionSnapshot(), args.join(' ')).to.deep.equal(
        before
      );
    }
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
  });

  it('keeps numeric and shell-sensitive branch names literal through cwd and subdirectory selection', () => {
    const names = ['123', 'topic;$()&`literal`'];
    for (const name of names) fixture.branch(name, 'main');
    fs.writeFileSync(
      github.state,
      JSON.stringify(names.map((name, index) => github.pr(name, 30 + index)))
    );
    const subdirectory = path.join(fixture.repo, 'nested');
    fs.mkdirSync(subdirectory);
    const before = fixture.inspectionSnapshot();
    for (const name of names) {
      const result = fixture.run(
        ['--cwd', subdirectory, 'pr', name, '--quiet', '--no-interactive'],
        fixture.root
      );
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout)
        .to.include(`Branch: ${name}`)
        .and.include(`PR for ${name}`);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    expect(fs.existsSync(path.join(fixture.root, 'unexpected-tool'))).to.equal(
      false
    );
  });

  it('preserves dirty bytes, staging, damaged caches and saved recovery while using physical HEAD', () => {
    fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged\n');
    fixture.git(['add', 'base.txt']);
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'unstaged\n');
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([0, 255, 10])
    );
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
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Branch: base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['checkout', '--detach']);
    const detached = fixture.inspectionSnapshot();
    const implicit = fixture.run(['pr', '--no-interactive']);
    expect(implicit.status).to.equal(1);
    expect(implicit.stdout).to.equal('');
    expect(implicit.stderr).to.include('without a branch checked out');
    const explicit = fixture.run(['pr', 'base', '--no-interactive']);
    expect(explicit.status, explicit.stdout + explicit.stderr).to.equal(0);
    expect(explicit.stdout).to.include('Branch: base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(detached);
  });

  it('reports unavailable policy and checks explicitly and refuses web when no PR exists', () => {
    const pr = {
      ...github.pr('base'),
      reviewDecision: '',
      mergeable: null,
      mergeStateStatus: null,
      statusCheckRollup: null,
      author: null,
    };
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    const unknown = fixture.run(['pr', '--quiet', '--no-interactive']);
    expect(unknown.status, unknown.stderr).to.equal(0);
    expect(unknown.stdout)
      .to.include('Review: UNKNOWN')
      .and.include('Readiness: UNKNOWN')
      .and.include('Checks: UNKNOWN')
      .and.include('Mergeability: UNKNOWN')
      .and.include('Author: UNKNOWN');
    fs.writeFileSync(
      github.state,
      JSON.stringify([{ ...pr, statusCheckRollup: [] }])
    );
    const empty = fixture.run(['pr', '--no-interactive']);
    expect(empty.status, empty.stderr).to.equal(0);
    expect(empty.stdout)
      .to.include('Checks: none reported')
      .and.include('Required policy: UNKNOWN');
    fs.writeFileSync(github.state, '[]');
    const before = fixture.inspectionSnapshot();
    expect(fixture.ok(['pr'])).to.include('No pull request.');
    const result = fixture.run(['pr', '--web', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('no pull request to open');
    expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses stale associations, wrong identities and ambiguous PRs without relinking', () => {
    const number = github.associate();
    const fresh = github.pr('base', number);
    const before = fixture.inspectionSnapshot();
    const cases = [
      {
        value: [{ ...fresh, headRefName: 'child' }],
        error: 'Stale pull request association',
      },
      {
        value: [
          { ...fresh, url: `https://github.com/other/repo/pull/${number}` },
        ],
        error: 'repository or number identity mismatch',
      },
      {
        value: [
          {
            ...fresh,
            headRepositoryOwner: { login: 'fork' },
            isCrossRepository: true,
          },
        ],
        error: 'same-repository',
      },
      { value: [{ ...fresh, headRefOid: 'short' }], error: 'Malformed' },
      {
        value: [
          {
            ...fresh,
            headRepository: {
              name: 'inspection',
              nameWithOwner: 'other/inspection',
            },
          },
        ],
        error: 'head repository identity mismatch',
      },
    ];
    for (const scenario of cases) {
      fs.writeFileSync(github.state, JSON.stringify(scenario.value));
      const result = fixture.run(['pr', '--web', '--no-interactive']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr).to.include(scenario.error);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(github.browser, 'utf8')).to.equal('');
    }
    fs.writeFileSync(
      github.state,
      JSON.stringify([github.pr('child', 31), github.pr('child', 32)])
    );
    const ambiguous = fixture.run(['pr', 'child', '--no-interactive']);
    expect(ambiguous.status).to.equal(1);
    expect(ambiguous.stderr).to.include('Ambiguous');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('does not reuse a stored association from a different configured repository', () => {
    const number = github.associate();
    fixture.ok(['repo', 'owner', '--set', 'other']);
    const before = fixture.inspectionSnapshot();
    // Even a matching PR in a new repository must not silently replace the old association.
    fs.writeFileSync(
      path.join(github.bin, 'gh'),
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(
        JSON.stringify({
          ...github.pr('base', number),
          url: `https://github.com/other/inspection/pull/${number}`,
          headRepositoryOwner: { login: 'other' },
          headRepository: { name: 'inspection' },
        })
      )});`,
      { mode: 0o755 }
    );
    const result = fixture.run(['pr', '--no-interactive']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal('');
    expect(result.stderr).to.include('Stored pull request association');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('distinguishes missing gh, authentication, rate limit, network and malformed responses from no PR', () => {
    const before = fixture.inspectionSnapshot();
    const script = path.join(github.bin, 'gh');
    const failures = [
      {
        stderr: 'HTTP 401: Bad credentials',
        stdout: '',
        status: 1,
        expected: 'authentication or permission',
      },
      {
        stderr: 'HTTP 403: Resource not accessible by integration',
        stdout: '',
        status: 1,
        expected: 'authentication or permission',
      },
      {
        stderr: 'API rate limit exceeded',
        stdout: '',
        status: 1,
        expected: 'rate limit',
      },
      {
        stderr: 'error connecting to api.github.com',
        stdout: '',
        status: 1,
        expected: 'network failure',
      },
      { stderr: '', stdout: '{broken', status: 0, expected: 'Malformed' },
      { stderr: '', stdout: '{}', status: 0, expected: 'Malformed' },
      {
        stderr: '',
        stdout: '[{"number":1}]',
        status: 0,
        expected: 'Malformed',
      },
    ];
    for (const failure of failures) {
      fs.writeFileSync(
        script,
        `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(
          failure.stdout
        )});process.stderr.write(${JSON.stringify(
          failure.stderr
        )});process.exitCode=${failure.status};`,
        { mode: 0o755 }
      );
      const result = fixture.run(['pr', '--no-interactive']);
      expect(result.status, failure.expected).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr)
        .to.include(failure.expected)
        .and.not.include('No pull request');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fs.unlinkSync(script);
    fs.symlinkSync('/usr/bin/git', path.join(github.bin, 'git'));
    fixture.env.PATH = github.bin;
    const missing = fixture.run(['pr', '--no-interactive']);
    expect(missing.status).to.equal(1);
    expect(missing.stderr).to.include('GitHub CLI is missing');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('preserves a real detached rebase recovery and permits only explicit branch inspection', () => {
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
    fs.writeFileSync(github.state, JSON.stringify([github.pr('base')]));
    const before = fixture.inspectionSnapshot();
    const implicit = fixture.run(['pr', '--no-interactive']);
    expect(implicit.status).to.equal(1);
    expect(implicit.stderr).to.include('without a branch checked out');
    const explicit = fixture.run(['pr', 'base', '--no-interactive']);
    expect(explicit.status, explicit.stderr).to.equal(0);
    expect(explicit.stdout).to.include('Branch: base');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('refuses uninitialized, untracked and unsupported-host repositories without repairing them', () => {
    fixture.git(['switch', '-c', 'untracked']);
    const before = fixture.inspectionSnapshot();
    const untracked = fixture.run(['pr', '--no-interactive']);
    expect(untracked.status).to.equal(1);
    expect(untracked.stdout).to.equal('');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git([
      'remote',
      'set-url',
      'origin',
      'https://enterprise.example/fixture/inspection.git',
    ]);
    const hostBefore = fixture.inspectionSnapshot();
    const host = fixture.run(['pr', 'base', '--no-interactive']);
    expect(host.status).to.equal(1);
    expect(host.stderr).to.include('github.com repositories only');
    expect(fixture.inspectionSnapshot()).to.deep.equal(hostBefore);
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_repo_config'));
    const uninitializedBefore = fixture.inspectionSnapshot();
    const uninitialized = fixture.run(['pr', '--no-interactive']);
    expect(uninitialized.status).to.equal(1);
    expect(uninitialized.stdout).to.equal('');
    expect(uninitialized.stderr).to.include('initialized repository');
    expect(fixture.inspectionSnapshot()).to.deep.equal(uninitializedBefore);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
  });
});
