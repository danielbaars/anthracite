import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public one-leaf landing', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
  });
  afterEach(() => fixture?.cleanup());
  it('rebase merges the selected leaf, fast-forwards trunk and cleans only landed refs and metadata', () => {
    const original = fixture.git(['rev-parse', 'leaf']);
    const unrelated = fixture.git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads/base',
      'refs/branch-metadata/base',
    ]);
    const nested = path.join(fixture.repo, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        {
          ...github.pr('leaf', 31),
          reviewDecision: null,
          statusCheckRollup: [],
        },
      ])
    );
    const result = fixture.run(
      ['--cwd', nested, 'land', '--yes', '--quiet', '--no-interactive'],
      fixture.root
    );
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    const merged = fixture.git(['rev-parse', 'main'], github.remote);
    expect(merged).not.to.equal(original);
    expect(fixture.git(['show', 'main:leaf.txt'], github.remote)).to.equal(
      'leaf'
    );
    expect(fixture.git(['rev-parse', 'main'])).to.equal(merged);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/leaf',
        'refs/branch-metadata/leaf',
      ])
    ).to.equal('');
    expect(
      fixture.git(['ls-remote', '--heads', 'origin', 'refs/heads/leaf'])
    ).to.equal('');
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads/base',
        'refs/branch-metadata/base',
      ])
    ).to.equal(unrelated);
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(false);
    expect(result.stdout)
      .to.include('Confirmed merged')
      .and.include('Landing complete');
  });
  it('retains an accepted uncertain merge and resumes from a fresh process without merging twice', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, loseMergeResponse: true, autoDelete: true })
    );
    const result = fixture.run(['land', '--yes']);
    expect(result.status, result.stdout + result.stderr).to.equal(1);
    expect(result.stdout + result.stderr)
      .to.include('Confirmed merged')
      .and.include('uncertain');
    expect(fixture.git(['show', 'main:leaf.txt'], github.remote)).to.equal(
      'leaf'
    );
    expect(
      fixture.git(['ls-remote', '--heads', 'origin', 'refs/heads/leaf'])
    ).to.equal('');
    expect(
      fs.existsSync(path.join(fixture.repo, '.git', '.anthracite_landing'))
    ).to.equal(true);
    const journal = fs.readFileSync(
      path.join(fixture.repo, '.git', '.anthracite_landing'),
      'utf8'
    );
    expect(journal).not.to.include(github.remote);
    expect(JSON.parse(journal).remoteUrlHash).to.match(/^[a-f0-9]{64}$/);
    const corrupted = JSON.parse(journal);
    corrupted.merges[0].remoteHead = 'f'.repeat(40);
    const recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
    fs.writeFileSync(recordPath, JSON.stringify(corrupted));
    const refused = fixture.run(['land', '--yes']);
    expect(refused.status).to.equal(1);
    expect(refused.stderr).to.include('Invalid or foreign');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(
      JSON.stringify(corrupted)
    );
    fs.writeFileSync(recordPath, journal);
    const retry = fixture.run(['land', 'leaf', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
  });

  it('preserves unrelated recovery and blocks ordinary mutation before initialization can erase pending landing', () => {
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'hooks', 'pre-push'),
      '#!/bin/sh\nexit 23\n',
      { mode: 0o755 }
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status).to.equal(1);
    expect(failed.stdout + failed.stderr)
      .to.include('Confirmed merged')
      .and.include('remote cleanup');
    const different = fixture.run(['land', 'base', '--yes']);
    expect(different.status).to.equal(1);
    expect(different.stderr).to.include('different landing target');
    const saved = path.join(fixture.repo, '.git', '.gtcontinue');
    fs.writeFileSync(saved, 'opaque old continuation');
    const before = fixture.inspectionSnapshot();
    const progress = fs.readFileSync(
      path.join(fixture.repo, '.git', '.anthracite_landing'),
      'utf8'
    );
    for (const command of [
      ['init', '--trunk', 'main'],
      ['continue'],
      ['sync'],
      ['create', 'surprise'],
      ['modify', '--commit', '--message', 'surprise'],
    ]) {
      const result = fixture.run(command);
      expect(result.status, command.join(' ')).to.equal(1);
      expect(result.stderr).to.include('Pending landing');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(
          path.join(fixture.repo, '.git', '.anthracite_landing'),
          'utf8'
        )
      ).to.equal(progress);
    }
    expect(fs.readFileSync(saved, 'utf8')).to.equal('opaque old continuation');
  });

  it('reconciles after target deletion and restores a surviving original checkout', () => {
    fixture.git(['switch', 'other']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif ! git show-ref --verify --quiet refs/heads/leaf; then exit 24; fi\n',
      { mode: 0o755 }
    );
    const failed = fixture.run(['land', 'leaf', '--yes']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(failed.stderr)
      .to.include('checkout restoration')
      .and.include('Confirmed merged');
    expect(
      fixture.git([
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/leaf',
        'refs/branch-metadata/leaf',
      ])
    ).to.equal('');
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('preserves a remote head changed inside pre-push using the captured deletion lease', () => {
    const original = fixture.git(['rev-parse', 'leaf']);
    const tree = fixture.git(['rev-parse', 'leaf^{tree}'], github.remote);
    const competing = fixture.git(
      [
        '-c',
        'user.name=Concurrent',
        '-c',
        'user.email=concurrent@example.test',
        'commit-tree',
        tree,
        '-p',
        original,
        '-m',
        'Concurrent remote work',
      ],
      github.remote
    );
    const hook = path.join(fixture.repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\ngit --git-dir="' +
        github.remote +
        '" update-ref refs/heads/leaf ' +
        competing +
        ' ' +
        original +
        '\n',
      { mode: 0o755 }
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(failed.stderr)
      .to.include('remote cleanup')
      .and.include('Confirmed merged');
    expect(fixture.git(['rev-parse', 'leaf'], github.remote)).to.equal(
      competing
    );
    expect(fixture.git(['rev-parse', 'leaf'])).to.equal(original);
    expect(fixture.ok(['pr', 'leaf'])).to.include('#31');
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status).to.equal(1);
    expect(retry.stderr).to.include('Remote branch changed');
    expect(fixture.git(['rev-parse', 'leaf'], github.remote)).to.equal(
      competing
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('retains a confirmed merge when trunk advancement fails and resumes without resetting local work', () => {
    const trunk = fixture.git(['rev-parse', 'main']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 25\n', { mode: 0o755 });
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status).to.equal(1);
    expect(failed.stderr)
      .to.include('trunk advance')
      .and.include('Confirmed merged');
    expect(fixture.git(['rev-parse', 'main'])).to.equal(trunk);
    expect(fixture.git(['show', 'main:leaf.txt'], github.remote)).to.equal(
      'leaf'
    );
    expect(fixture.git(['rev-parse', 'leaf'])).not.to.equal('');
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', 'leaf', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });

  it('preserves invalid and foreign landing records and refuses before external effects', () => {
    const record = path.join(fixture.repo, '.git', '.anthracite_landing');
    for (const value of [
      'opaque invalid landing',
      JSON.stringify({ owner: 'another tool', version: 1 }),
    ]) {
      fs.writeFileSync(record, value);
      const before = fixture.inspectionSnapshot();
      const failed = fixture.run(['land', 'leaf', '--yes']);
      expect(failed.status).to.equal(1);
      expect(failed.stderr).to.include('Invalid or foreign');
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fs.readFileSync(record, 'utf8')).to.equal(value);
      expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
    }
    fs.unlinkSync(record);
    const missing = path.join(fixture.root, 'foreign-missing-record');
    fs.symlinkSync(missing, record);
    const symlink = fixture.run(['land', 'leaf', '--yes']);
    expect(symlink.status).to.equal(1);
    expect(symlink.stderr).to.include('Invalid or foreign');
    expect(fs.readlinkSync(record)).to.equal(missing);
    expect(fs.readFileSync(github.calls, 'utf8')).to.equal('');
  });
  it('retains merge intent through terminal interruption and reconciles it in a fresh process', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, interruptAfterMerge: true })
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(failed.stderr).to.include('Landing interrupted');
    const record = JSON.parse(
      fs.readFileSync(
        path.join(fixture.repo, '.git', '.anthracite_landing'),
        'utf8'
      )
    );
    expect(record.phase).to.equal('merge-requested');
    expect(fixture.git(['show', 'main:leaf.txt'], github.remote)).to.equal(
      'leaf'
    );
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('rejects an expected-head race at the direct merge boundary without merging newer remote work', () => {
    const original = fixture.git(['rev-parse', 'leaf']);
    const trunk = fixture.git(['rev-parse', 'main']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, moveHeadBeforeMerge: true })
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(fixture.git(['rev-parse', 'main'], github.remote)).to.equal(trunk);
    expect(fixture.git(['rev-parse', 'leaf'], github.remote)).not.to.equal(
      original
    );
    expect(fixture.git(['rev-parse', 'leaf'])).to.equal(original);
    expect(JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state).to.equal(
      'OPEN'
    );
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status).to.equal(1);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('refuses an exit-zero queued response and never treats an unmerged PR as landed', () => {
    const trunk = fixture.git(['rev-parse', 'main']);
    const head = fixture.git(['rev-parse', 'leaf']);
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, queuedResponse: true })
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
    expect(failed.stdout).not.to.include('Confirmed merged');
    expect(fixture.git(['rev-parse', 'main'], github.remote)).to.equal(trunk);
    expect(fixture.git(['rev-parse', 'leaf'])).to.equal(head);
    expect(fixture.git(['rev-parse', 'leaf'], github.remote)).to.equal(head);
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status).to.equal(1);
    expect(retry.stderr).to.include('No merge is repeated');
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
  it('refuses multiple push destinations before merge, record or remote cleanup effects', () => {
    const second = path.join(fixture.root, 'second-remote.git');
    fixture.git(['init', '--bare', second]);
    fixture.git(['remote', 'set-url', '--add', '--push', 'origin', second]);
    const before = fixture.inspectionSnapshot();
    const remote = fixture.git(['for-each-ref'], github.remote);
    for (const args of [['--dry-run'], ['--yes']]) {
      const failed = fixture.run(['land', ...args]);
      expect(failed.status, failed.stdout + failed.stderr).to.equal(1);
      expect(failed.stdout + failed.stderr).to.include(
        'one matching fetch/push remote endpoint'
      );
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fixture.git(['for-each-ref'], second)).to.equal('');
    }
    expect(fs.readFileSync(github.calls, 'utf8')).not.to.include('"PUT"');
  });
  it('preserves an unrelated branch when a post-checkout hook redirects HEAD before trunk advance', () => {
    fixture.branch('spare', 'main', true);
    fixture.git(['switch', 'leaf']);
    const spare = fixture.git(['rev-parse', 'spare']);
    const trunk = fixture.git(['rev-parse', 'main']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif [ "$(git branch --show-current)" = main ]; then git symbolic-ref HEAD refs/heads/spare; fi\n',
      { mode: 0o755 }
    );
    const failed = fixture.run(['land', '--yes']);
    expect(failed.status).to.equal(1);
    expect(failed.stderr)
      .to.include('trunk advance')
      .and.include('Confirmed merged');
    expect(fixture.git(['rev-parse', 'spare'])).to.equal(spare);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(trunk);
    expect(fixture.git(['show', 'main:leaf.txt'], github.remote)).to.equal(
      'leaf'
    );
    fs.unlinkSync(hook);
    const retry = fixture.run(['land', '--yes']);
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['rev-parse', 'spare'])).to.equal(spare);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
});
