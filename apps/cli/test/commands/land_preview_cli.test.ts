import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public scoped landing preview', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());
  it('previews the exact prefix and full surviving fanout without persistent effects', () => {
    fixture.branch('sibling', 'base');
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    const result = fixture.run([
      'land',
      'child',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Merge 1: base #17')
      .and.include('Merge 2: child #18')
      .and.include('Maintain: tip')
      .and.include('Maintain: sibling')
      .and.include('No required reviews or checks')
      .and.include('Cleanup: base, child');
    expect(result.stdout)
      .not.to.include('Maintain: other')
      .and.not.to.include('Merge 3:');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });
  it('reads every active rules page and refuses unavailable classic policy rather than trusting 404', () => {
    const rules = [
      ...Array.from({ length: 100 }, () => ({ type: 'deletion' })),
      { type: 'merge_queue' },
    ];
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ allow_rebase_merge: true, protected: false, rules })
    );
    const before = fixture.inspectionSnapshot();
    const queue = fixture.run(['land', '--dry-run']);
    expect(queue.status).to.equal(1);
    expect(queue.stdout).to.include('Merge queue policy is unsupported');
    expect(fs.readFileSync(github.calls, 'utf8')).to.include('page=2');
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: null,
      })
    );
    const unknown = fixture.run(['land', '--dry-run']);
    expect(unknown.status).to.equal(1);
    expect(unknown.stderr).to.include('policy unavailable');
    expect(unknown.stdout).not.to.include('No required reviews or checks');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('reports all later readiness blockers before applying and accepts known empty requirements', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {
          url: 'https://api.github.com/repos/fixture/inspection/branches/main/protection',
          required_pull_request_reviews: { required_approving_review_count: 1 },
          required_status_checks: { contexts: ['mandatory'] },
        },
      })
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify(
        github.prs.map((pr) => ({
          ...pr,
          reviewDecision: '',
          statusCheckRollup: [],
        }))
      )
    );
    const before = fixture.inspectionSnapshot();
    const blocked = fixture.run(['land', 'child', '--yes']);
    expect(blocked.status).to.equal(1);
    expect(blocked.stdout)
      .to.include('base: Required approvals missing')
      .and.include('child: Required approvals missing')
      .and.include('Required check missing');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ allow_rebase_merge: true, protected: false, rules: [] })
    );
    const ready = fixture.run(['land', '--dry-run']);
    expect(ready.status, ready.stdout + ready.stderr).to.equal(0);
    expect(ready.stdout)
      .to.include('No required reviews or checks')
      .and.include('Readiness: READY');
  });

  it('refuses local dirt and recovery while preserving every byte', () => {
    for (const [file, text] of [
      ['untracked.txt', 'untracked'],
      ['base.txt', 'dirty'],
    ]) {
      fs.writeFileSync(path.join(fixture.repo, file), text);
      const before = fixture.inspectionSnapshot();
      const blocked = fixture.run(['land', '--dry-run']);
      expect(blocked.status).to.equal(1);
      expect(blocked.stdout).to.include('Clean index/worktree required');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      if (file === 'untracked.txt')
        fs.unlinkSync(path.join(fixture.repo, file));
      else fixture.git(['restore', file]);
    }
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.gtcontinue'),
      'opaque invalid recovery'
    );
    const before = fixture.inspectionSnapshot();
    const recovery = fixture.run(['land', '--dry-run']);
    expect(recovery.status).to.equal(1);
    expect(recovery.stdout + recovery.stderr).to.match(
      /Saved recovery|Malformed data/
    );
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('requires explicit application consent and refuses unimplemented scopes before writes', () => {
    const before = fixture.inspectionSnapshot();
    const refusal = fixture.run(['land', '--no-interactive']);
    expect(refusal.status).to.equal(1);
    expect(refusal.stderr).to.include('requires --yes');
    const authorized = fixture.run(['land', '--yes', '--no-interactive']);
    expect(authorized.status).to.equal(1);
    expect(authorized.stderr).to.include('not implemented');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('PUT')
      .and.not.to.include('POST');
  });

  it('supports literal selectors, help and completion and rejects unsupported routes', () => {
    expect(fixture.ok(['land', '--help']))
      .to.include('--dry-run')
      .and.include('--yes');
    expect(
      fixture
        .run(['--get-yargs-completions', 'an', 'land', ''])
        .stdout.split('\n')
    ).to.include('base');
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['base', 'child'],
      [''],
      ['--branch=base'],
      ['--dry-run=maybe'],
      ['--count', '2'],
      ['--all'],
      ['--force'],
      ['--admin'],
      ['--queue'],
      ['--squash'],
      ['main'],
      ['missing'],
    ]) {
      const result = fixture.run(['land', ...args, '--dry-run']);
      expect(result.status, args.join(' ')).to.equal(1);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    for (const name of ['123', 'topic;$()&`literal`']) {
      fixture.branch(name, 'main');
      fixture.git(['push', 'origin', name]);
      fs.writeFileSync(github.state, JSON.stringify([github.pr(name)]));
      const result = fixture.run(['land', name, '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include(`Merge 1: ${name} #17`);
    }
  });

  it('inspects fresh remote trunk objects outside the source repository and recognizes verified merged cleanup', () => {
    fixture.git(
      ['update-ref', 'refs/heads/main', fixture.git(['rev-parse', 'base'])],
      github.remote
    );
    const merged = {
      ...github.prs[0],
      state: 'MERGED',
      mergeResult: fixture.git(['rev-parse', 'base']),
    };
    fs.writeFileSync(github.state, JSON.stringify([merged]));
    fixture.git(['push', 'origin', '--delete', 'base']);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout)
      .to.include('Cleanup-only 1: base #17')
      .and.not.to.include('Merge 1:');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('leaves unseen remote trunk objects and FETCH_HEAD outside the repository', () => {
    const parent = fixture.git(['rev-parse', 'main'], github.remote);
    const tree = fixture.git(['rev-parse', 'main^{tree}'], github.remote);
    const fresh = fixture.git(
      [
        '-c',
        'user.name=Remote',
        '-c',
        'user.email=remote@example.test',
        'commit-tree',
        tree,
        '-p',
        parent,
        '-m',
        'Remote trunk advance',
      ],
      github.remote
    );
    fixture.git(['update-ref', 'refs/heads/main', fresh], github.remote);
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(fresh).and.include('fast-forward only');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', 'FETCH_HEAD'))
    ).to.equal(false);
    expect(() => fixture.git(['cat-file', '-e', fresh])).to.throw();
  });

  it('protects mandatory participants and ignores frozen or occupied independent stacks', () => {
    fixture.ok(['freeze', 'other']);
    fixture.git([
      'worktree',
      'add',
      path.join(fixture.root, 'other-worktree'),
      'other',
    ]);
    expect(fixture.run(['land', '--dry-run']).status).to.equal(0);
    fixture.ok(['freeze', 'child']);
    const frozen = fixture.inspectionSnapshot();
    const blocked = fixture.run(['land', '--dry-run']);
    expect(blocked.status).to.equal(1);
    expect(blocked.stdout).to.include('child').and.include('frozen');
    expect(fixture.inspectionSnapshot()).to.deep.equal(frozen);
    fixture.ok(['unfreeze', 'child']);
    fixture.git([
      'worktree',
      'add',
      path.join(fixture.root, 'child-worktree'),
      'child',
    ]);
    const occupied = fixture.inspectionSnapshot();
    const unavailable = fixture.run(['land', '--dry-run']);
    expect(unavailable.status).to.equal(1);
    expect(unavailable.stdout).to.include('child-worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(occupied);
  });

  it('reports unpublished published-head commits, divergent trunk, staged changes and active Git operations', () => {
    fixture.commit('unpublished');
    let before = fixture.inspectionSnapshot();
    let result = fixture.run(['land', '--dry-run']);
    expect(result.status).to.equal(1);
    expect(result.stdout)
      .to.include('published head differs')
      .and.include('PR head differs');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['switch', 'main']);
    fixture.commit('local-trunk-only');
    fixture.git(['switch', 'base']);
    before = fixture.inspectionSnapshot();
    result = fixture.run(['land', '--dry-run']);
    expect(result.status).to.equal(1);
    expect(result.stdout).to.include('Local trunk is divergent');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'MERGE_HEAD'),
      fixture.git(['rev-parse', 'main'])
    );
    fs.writeFileSync(path.join(fixture.repo, 'base.txt'), 'staged');
    fixture.git(['add', 'base.txt']);
    before = fixture.inspectionSnapshot();
    result = fixture.run(['land', '--dry-run']);
    expect(result.status).to.equal(1);
    expect(result.stdout)
      .to.include('MERGE_HEAD')
      .and.include('Clean index/worktree');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('cancels terminal confirmation and revalidates changed participants before application', () => {
    const before = fixture.inspectionSnapshot();
    const cancel = runCliInPty(getTestCliCommand(['land']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [{ prompt: 'Apply this landing plan?', input: 'n\r' }],
    });
    expect(cancel.status, cancel.output).to.equal(0);
    expect(cancel.output).to.include('Landing cancelled');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    const change = path.join(fixture.root, 'change-policy.js');
    fs.writeFileSync(
      change,
      `require('fs').writeFileSync(${JSON.stringify(
        github.policy
      )}, JSON.stringify({ allow_rebase_merge: false, protected: false, rules: [] }));`
    );
    const changed = runCliInPty(getTestCliCommand(['land']), {
      cwd: fixture.repo,
      env: fixture.env,
      responses: [
        {
          prompt: 'Apply this landing plan?',
          input: 'y\r',
          beforeInput: [process.execPath, change],
        },
      ],
    });
    expect(changed.status, changed.output).to.equal(1);
    expect(changed.output).to.include('changed after confirmation');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('does not accept malformed classic policy as known no-requirements', () => {
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        allow_rebase_merge: true,
        protected: true,
        rules: [],
        protection: {},
      })
    );
    const before = fixture.inspectionSnapshot();
    const result = fixture.run(['land', '--dry-run']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout).not.to.include('No required reviews or checks');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });
  it('fails closed for readiness, policy, and PR identity blockers without remote writes', () => {
    const cases = [
      { change: { isDraft: true }, message: 'draft' },
      { change: { state: 'CLOSED' }, message: 'not open' },
      { change: { baseRefName: 'other' }, message: 'tracked parent' },
      { change: { headRefOid: 'f'.repeat(40) }, message: 'PR head differs' },
      { change: { mergeable: 'UNKNOWN' }, message: 'Mergeability is UNKNOWN' },
      { change: { mergeStateStatus: null }, message: 'readiness is UNKNOWN' },
      {
        change: { reviewDecision: 'CHANGES_REQUESTED' },
        message: 'Changes requested',
      },
      { change: { statusCheckRollup: null }, message: 'Checks unavailable' },
      {
        change: {
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'unit',
              status: 'IN_PROGRESS',
              conclusion: null,
            },
          ],
        },
        message: 'IN_PROGRESS',
      },
      {
        change: {
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'unit',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
            },
          ],
        },
        message: 'FAILURE',
      },
    ];
    const before = fixture.inspectionSnapshot();
    for (const entry of cases) {
      fs.writeFileSync(
        github.state,
        JSON.stringify([
          { ...github.prs[0], ...entry.change },
          ...github.prs.slice(1),
        ])
      );
      const result = fixture.run(['land', '--dry-run']);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
      expect(result.stdout).to.include(entry.message);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fs.writeFileSync(github.state, JSON.stringify(github.prs));
    for (const entry of [
      {
        policy: { allow_rebase_merge: false, protected: false, rules: [] },
        message: 'disabled',
      },
      {
        policy: {
          allow_rebase_merge: true,
          protected: false,
          rules: [{ type: 'unknown_rule' }],
        },
        message: 'Unsupported active policy',
      },
    ]) {
      fs.writeFileSync(github.policy, JSON.stringify(entry.policy));
      const result = fixture.run(['land', '--dry-run']);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.include(entry.message);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    }
    fs.writeFileSync(github.state, '[]');
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ allow_rebase_merge: true, protected: false, rules: [] })
    );
    expect(fixture.run(['land', '--dry-run']).stdout).to.include(
      'Missing pull request'
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        github.prs[0],
        {
          ...github.prs[0],
          number: 99,
          url: 'https://github.com/fixture/inspection/pull/99',
        },
      ])
    );
    expect(fixture.run(['land', '--dry-run']).stderr).to.include('Ambiguous');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(github.calls, 'utf8'))
      .not.to.include('PUT')
      .and.not.to.include('POST');
  });
  it('previews the full chain through quiet cwd selection and preserves detached or uninitialized refusals', () => {
    const nested = path.join(fixture.repo, 'nested');
    fs.mkdirSync(nested);
    const before = fixture.inspectionSnapshot();
    const full = fixture.run(
      [
        '--cwd',
        nested,
        'land',
        'tip',
        '--dry-run',
        '--quiet',
        '--no-interactive',
      ],
      fixture.root
    );
    expect(full.status, full.stdout + full.stderr).to.equal(0);
    expect(full.stdout)
      .to.include('Merge 1: base #17')
      .and.include('Merge 2: child #18')
      .and.include('Merge 3: tip #19');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    fixture.git(['checkout', '--detach']);
    const detached = fixture.inspectionSnapshot();
    for (const selection of [[], ['base']]) {
      const result = fixture.run(['land', ...selection, '--dry-run']);
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include('physically checked-out branch');
      expect(fixture.inspectionSnapshot()).to.deep.equal(detached);
    }
    fixture.git(['checkout', 'base']);
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_repo_config'));
    const uninitialized = fixture.inspectionSnapshot();
    const result = fixture.run(['land', '--dry-run']);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('initialized repository');
    expect(fixture.inspectionSnapshot()).to.deep.equal(uninitialized);
  });
});
