import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public unconfirmed landing retry preview', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  let recordPath: string;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    recordPath = path.join(fixture.repo, '.git', '.anthracite_landing');
  });
  afterEach(() => fixture?.cleanup());

  function leaveUnconfirmed(producer?: string): void {
    const gh = path.join(github.bin, 'gh');
    const original = fs.readFileSync(gh, 'utf8');
    fs.writeFileSync(
      gh,
      original.replace(
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
        "process.stderr.write('error connecting to api.github.com: timeout\\n');process.exit(1);\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));"
      )
    );
    const args = ['land', 'leaf', '--yes', '--no-interactive'];
    const stopped = producer
      ? spawnSync(producer, args, {
          cwd: fixture.repo,
          env: fixture.env,
          encoding: 'utf8',
          timeout: 120000,
        })
      : fixture.run(args);
    expect(stopped.status, stopped.stdout + stopped.stderr).to.equal(1);
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).phase).to.equal(
      'merge-requested'
    );
    fs.writeFileSync(gh, original);
  }

  it('previews one proposed retry without changing recovery, Git state or remote effects', () => {
    leaveUnconfirmed();
    const before = fixture.inspectionSnapshot();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const remote = fixture.git(['for-each-ref'], github.remote);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const head = fixture.git(['rev-parse', 'leaf']);
    const preview = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
      '--no-interactive',
    ]);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout)
      .to.include('Proposed retry: #31 leaf')
      .and.include(head);
    expect(preview.stdout)
      .to.include('earlier outcome remains unconfirmed')
      .and.include('confirmation');
    expect(preview.stdout)
      .to.include('Remaining PRs')
      .and.include('Checkout after completion: main');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
  });
  it('keeps ordinary preview and yes blocked and grants no execution authority in this slice', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const calls = fs.readFileSync(github.calls, 'utf8');
    for (const args of [
      ['land', 'leaf', '--dry-run', '--no-interactive'],
      ['land', 'leaf', '--yes', '--no-interactive'],
      ['land', 'leaf', '--retry-unconfirmed', '--yes', '--no-interactive'],
    ]) {
      const result = fixture.run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(1);
    }
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
    // Ordinary resumption refreshes lock ownership; exceptional inspection does not.
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const original = JSON.parse(saved);
    expect({ ...record, cacheLock: undefined }).to.deep.equal({
      ...original,
      cacheLock: undefined,
    });
  });

  it('requires the explicit original target and preserves recovery for invalid entry points', () => {
    const absent = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
    ]);
    expect(absent.status).to.equal(1);
    expect(fs.existsSync(recordPath)).to.equal(false);
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const before = fixture.inspectionSnapshot();
    for (const args of [
      ['land', '--retry-unconfirmed', '--dry-run'],
      ['land', 'other', '--retry-unconfirmed', '--dry-run'],
      ['land', 'leaf', '--retry-unconfirmed=false-value', '--dry-run'],
    ])
      expect(fixture.run(args).status).to.equal(1);
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('retains fresh local and pinned-head blockers without retry writes', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    fs.writeFileSync(path.join(fixture.repo, 'untracked.txt'), 'local work');
    const dirty = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
    ]);
    expect(dirty.status).to.equal(1);
    expect(dirty.stdout + dirty.stderr).to.include('Clean index/worktree');
    fs.unlinkSync(path.join(fixture.repo, 'untracked.txt'));
    const pr = github.pr('leaf', 31);
    fs.writeFileSync(
      github.state,
      JSON.stringify([{ ...pr, headRefOid: '1'.repeat(40) }])
    );
    const changed = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
    ]);
    expect(changed.status).to.equal(1);
    expect(changed.stdout + changed.stderr).to.match(/identity|head|Head/);
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
  });

  for (const [version, producer] of [
    [1, process.env.ANTHRACITE_TEST_LANDING_V1_PRODUCER],
    [2, process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER],
  ] as const) {
    it(`preserves genuine published version-${version} recovery during preview`, function () {
      if (!producer) this.skip();
      leaveUnconfirmed(producer);
      const saved = fs.readFileSync(recordPath, 'utf8');
      expect(JSON.parse(saved).version).to.equal(version);
      const before = fixture.inspectionSnapshot();
      const result = fixture.run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--dry-run',
      ]);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(result.stdout).to.include('Proposed retry: #31 leaf');
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
      expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    });
  }

  it('keeps a running required check blocking without waiting in preview', () => {
    leaveUnconfirmed();
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({
        ...policy,
        rules: [
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'ci' }] },
          },
        ],
      })
    );
    fs.writeFileSync(
      github.state,
      JSON.stringify([
        {
          ...github.pr('leaf', 31),
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'ci',
              status: 'IN_PROGRESS',
              conclusion: null,
            },
          ],
        },
      ])
    );
    const saved = fs.readFileSync(recordPath, 'utf8');
    const result = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
      '--wait-timeout',
      '600',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stdout + result.stderr).to.include('Check ci: IN_PROGRESS');
    expect(result.stdout).not.to.include('Waiting for');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
  });

  it('refuses malformed, foreign and wrong-phase records without rewriting them', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const original = JSON.parse(saved);
    for (const content of [
      '{invalid',
      JSON.stringify({ ...original, repo: 'other/project' }),
      JSON.stringify({ ...original, phase: 'prepared' }),
    ]) {
      fs.writeFileSync(recordPath, content);
      const result = fixture.run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--dry-run',
      ]);
      expect(result.status).to.equal(1);
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(content);
    }
  });

  it('discloses a freshly confirmed merge without proposing another request', () => {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, interruptAfterMerge: true })
    );
    fixture.run(['land', 'leaf', '--yes', '--no-interactive']);
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).phase).to.equal(
      'merge-requested'
    );
    const saved = fs.readFileSync(recordPath, 'utf8');
    const before = fixture.inspectionSnapshot();
    const result = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--dry-run',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include(
      'No retry request needed: #31 is confirmed merged.'
    );
    expect(result.stdout).not.to.include('Proposed retry');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
  });

  it('exposes the named opt-in in help and completion', () => {
    const help = fixture.run(['land', '--help']);
    expect(help.stdout)
      .to.include('--retry-unconfirmed')
      .and.include('separately confirm');
    const completion = fixture.run([
      '--get-yargs-completions',
      'an',
      'land',
      '--',
    ]);
    expect(completion.stdout).to.include('--retry-unconfirmed');
  });
});
