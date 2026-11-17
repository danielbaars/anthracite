import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';
import { leaveLandingUnconfirmed } from '../lib/fixtures/landing_retry';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

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
    leaveLandingUnconfirmed(fixture, github, producer);
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
  it('keeps ordinary preview and yes blocked without fresh retry consent', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const calls = fs.readFileSync(github.calls, 'utf8');
    for (const args of [
      ['land', 'leaf', '--dry-run', '--no-interactive'],
      ['land', 'leaf', '--yes', '--no-interactive'],
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

  it('recovers one pinned leaf merge and retains exact original evidence after completion', () => {
    leaveUnconfirmed(process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER);
    const saved = fs.readFileSync(recordPath, 'utf8');
    const head = fixture.git(['rev-parse', 'leaf']);
    const gh = path.join(github.bin, 'gh');
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
          "const input = JSON.parse(fs.readFileSync(0, 'utf8')); fs.appendFileSync(process.env.ANTHRACITE_TEST_PR_CALLS, JSON.stringify(input) + '\\n');"
        )
    );
    const calls = fs.readFileSync(github.calls, 'utf8');
    const result = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(result.status, result.stdout + result.stderr).to.equal(0);
    expect(result.stdout).to.include('Landing complete: leaf');
    expect(fs.existsSync(recordPath)).to.equal(false);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
    expect(
      fixture.git([
        'for-each-ref',
        'refs/heads/leaf',
        'refs/branch-metadata/leaf',
      ])
    ).to.equal('');
    const requests = fs.readFileSync(github.calls, 'utf8').slice(calls.length);
    expect(requests.match(/"PUT"/g)).to.have.length(1);
    expect(requests).to.include(head);
    const archive = path.join(
      fixture.repo,
      '.git',
      '.anthracite_landing_retry'
    );
    const attempts = fs.readdirSync(archive);
    expect(attempts).to.have.length(1);
    expect(
      fs.readFileSync(path.join(archive, attempts[0], 'original.json'), 'utf8')
    ).to.equal(saved);
    expect(
      fs.existsSync(path.join(archive, attempts[0], 'intent.json'))
    ).to.equal(true);
  });

  it('declining the additional confirmation preserves the original record and creates no attempt', () => {
    leaveUnconfirmed();
    const before = fixture.inspectionSnapshot();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const calls = fs.readFileSync(github.calls, 'utf8');
    const result = runCliInPty(
      getTestCliCommand(['land', 'leaf', '--retry-unconfirmed']),
      {
        cwd: fixture.repo,
        env: fixture.env,
        timeoutMs: 60000,
        responses: [
          { prompt: 'Send at most one new merge request', input: 'n\n' },
        ],
      }
    );
    expect(result.status, result.output).to.equal(0);
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      fs.existsSync(
        path.join(fixture.repo, '.git', '.anthracite_landing_retry')
      )
    ).to.equal(false);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
  });

  it('retains the original uncertainty after a new definite rejection and gates unsupported readers', function () {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const gh = path.join(github.bin, 'gh');
    const original = fs.readFileSync(gh, 'utf8');
    fs.writeFileSync(
      gh,
      original.replace(
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
        "process.stdout.write(JSON.stringify({ status: '405', message: 'Merge blocked' })); process.stderr.write('gh: Merge blocked (HTTP 405)\\n'); process.exit(1);"
      )
    );
    const calls = fs.readFileSync(github.calls, 'utf8');
    const rejected = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(rejected.status, rejected.stdout + rejected.stderr).to.equal(1);
    expect(rejected.stderr).to.include('HTTP 405');
    const retained = fs.readFileSync(recordPath, 'utf8');
    const record = JSON.parse(retained);
    expect(record.phase).to.equal('merge-requested');
    expect(record.retry.number).to.equal(31);
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(
          fixture.repo,
          '.git',
          '.anthracite_landing_retry',
          record.retry.attempt,
          'rejected.json'
        ),
        'utf8'
      )
    );
    expect(receipt.detail).to.include('HTTP 405').and.include('Merge blocked');
    expect(
      fs.readFileSync(
        path.join(
          fixture.repo,
          '.git',
          '.anthracite_landing_retry',
          record.retry.attempt,
          'original.json'
        ),
        'utf8'
      )
    ).to.equal(saved);
    fs.writeFileSync(gh, original);
    for (const args of [
      ['land', 'leaf', '--yes', '--no-interactive'],
      ['land', 'leaf', '--retry-unconfirmed', '--yes', '--no-interactive'],
    ])
      expect(fixture.run(args).status).to.equal(1);
    for (const producer of [
      process.env.ANTHRACITE_TEST_LANDING_V1_PRODUCER,
      process.env.ANTHRACITE_TEST_LANDING_V2_PRODUCER,
    ]) {
      if (!producer) continue;
      const before = fs.readFileSync(recordPath, 'utf8');
      const old = spawnSync(
        producer,
        ['land', 'leaf', '--yes', '--no-interactive'],
        { cwd: fixture.repo, env: fixture.env, encoding: 'utf8' }
      );
      expect(old.status, old.stdout + old.stderr).to.equal(1);
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(before);
    }
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length).match(/"PUT"/g)
    ).to.have.length(1);
  });

  it('refuses an unsafe evidence directory before replacing original recovery or sending a request', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const archive = path.join(
      fixture.repo,
      '.git',
      '.anthracite_landing_retry'
    );
    fs.symlinkSync(fixture.root, archive);
    const calls = fs.readFileSync(github.calls, 'utf8');
    const result = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('Retry evidence could not be retained');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
  });

  it('refuses changed or closed pinned PRs and local or policy blockers during execution', () => {
    leaveUnconfirmed();
    const saved = fs.readFileSync(recordPath, 'utf8');
    const pr = github.pr('leaf', 31);
    const calls = fs.readFileSync(github.calls, 'utf8');
    for (const changed of [
      { ...pr, state: 'CLOSED' },
      { ...pr, number: 32 },
      { ...pr, headRefOid: '1'.repeat(40) },
    ]) {
      fs.writeFileSync(github.state, JSON.stringify([changed]));
      expect(
        fixture.run([
          'land',
          'leaf',
          '--retry-unconfirmed',
          '--yes',
          '--no-interactive',
        ]).status
      ).to.equal(1);
      expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    }
    fs.writeFileSync(github.state, JSON.stringify([pr]));
    fs.writeFileSync(path.join(fixture.repo, 'dirty.txt'), 'work');
    expect(
      fixture.run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--yes',
        '--no-interactive',
      ]).status
    ).to.equal(1);
    fs.unlinkSync(path.join(fixture.repo, 'dirty.txt'));
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, allow_rebase_merge: false })
    );
    expect(
      fixture.run([
        'land',
        'leaf',
        '--retry-unconfirmed',
        '--yes',
        '--no-interactive',
      ]).status
    ).to.equal(1);
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
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
    const calls = fs.readFileSync(github.calls, 'utf8');
    const application = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
      '--wait-timeout',
      '0',
    ]);
    expect(application.status).to.equal(1);
    expect(application.stderr).to.include('Check wait timed out');
    expect(fs.readFileSync(recordPath, 'utf8')).to.equal(saved);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
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
    const calls = fs.readFileSync(github.calls, 'utf8');
    const applied = fixture.run([
      'land',
      'leaf',
      '--retry-unconfirmed',
      '--yes',
      '--no-interactive',
    ]);
    expect(applied.status, applied.stdout + applied.stderr).to.equal(0);
    expect(
      fs.readFileSync(github.calls, 'utf8').slice(calls.length)
    ).not.to.include('"PUT"');
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
