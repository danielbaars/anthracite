import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

// eslint-disable-next-line max-lines-per-function
describe('public landing merge refusals', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  let gh: string;
  let original: string;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
    fixture.branch('leaf', 'main');
    fixture.git(['push', 'origin', 'leaf']);
    fs.writeFileSync(github.state, JSON.stringify([github.pr('leaf', 31)]));
    gh = path.join(github.bin, 'gh');
    original = fs.readFileSync(gh, 'utf8');
  });
  afterEach(() => fixture?.cleanup());

  function reply(body: unknown, stderr: string, exitCode = 1): void {
    fs.writeFileSync(
      gh,
      original.replace(
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
        `process.stdout.write(${JSON.stringify(
          JSON.stringify(body)
        )});process.stderr.write(${JSON.stringify(
          stderr
        )});process.exit(${exitCode});\nconst input = JSON.parse(fs.readFileSync(0, 'utf8'));`
      )
    );
  }

  for (const status of ['401', '403', '404', '405', '409', '422']) {
    it(`reports a definite HTTP${status} refusal and permits only a fresh explicit retry`, () => {
      const message = 'Rebase merges are not allowed on this repository';
      reply({ message, status }, `gh: ${message} (HTTP ${status})\n`);
      const remote = fixture.git(['for-each-ref'], github.remote);
      const refs = fixture.git(['for-each-ref']);
      const refused = fixture.run([
        'land',
        'leaf',
        '--yes',
        '--no-interactive',
      ]);
      expect(refused.status).to.equal(1);
      expect(refused.stderr).to.include(`HTTP ${status}`).and.include(message);
      expect(refused.stderr).not.to.include('outcome uncertain');
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
      expect(fixture.git(['for-each-ref'])).to.equal(refs);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(fixture.repo, '.git', '.anthracite_landing'),
            'utf8'
          )
        ).phase
      ).to.equal('prepared');
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      fs.writeFileSync(gh, original);
      const resumed = fixture.run([
        'land',
        'leaf',
        '--yes',
        '--no-interactive',
      ]);
      expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(2);
      expect(
        JSON.parse(fs.readFileSync(github.state, 'utf8'))[0].state
      ).to.equal('MERGED');
    });
  }
  for (const refusal of [
    {
      name: 'lost transport response',
      body: {},
      stderr: 'error connecting to api.github.com: timeout\n',
    },
    {
      name: 'server failure',
      body: { status: '500', message: 'Internal Server Error' },
      stderr: 'gh: Internal Server Error (HTTP 500)\n',
    },
    {
      name: 'conflicting HTTP evidence',
      body: { status: '405', message: 'Merge blocked' },
      stderr: 'gh: Merge blocked (HTTP 409)\n',
    },
    {
      name: 'contradictory merged flag',
      body: { status: '405', message: 'Merge blocked', merged: true },
      stderr: 'gh: Merge blocked (HTTP 405)\n',
    },
    {
      name: 'queued exit-zero reply',
      body: { merged: false, message: 'queued' },
      stderr: '',
      exitCode: 0,
    },
  ]) {
    it(`keeps ${refusal.name} uncertain without inviting a repeated merge`, () => {
      reply(refusal.body, refusal.stderr, refusal.exitCode ?? 1);
      const remote = fixture.git(['for-each-ref'], github.remote);
      const refused = fixture.run([
        'land',
        'leaf',
        '--yes',
        '--no-interactive',
      ]);
      expect(refused.status).to.equal(1);
      expect(refused.stderr).to.include('uncertain').and.include('--dry-run');
      expect(refused.stderr).not.to.include('rerun an land');
      if (refusal.name === 'server failure')
        expect(refused.stderr)
          .to.include('HTTP 500')
          .and.include('Internal Server Error');
      if (refusal.name === 'lost transport response')
        expect(refused.stderr).to.include('(network)');
      const record = path.join(fixture.repo, '.git', '.anthracite_landing');
      const saved = fs.readFileSync(record, 'utf8');
      expect(JSON.parse(saved).phase).to.equal('merge-requested');
      const preview = fixture.run([
        'land',
        'leaf',
        '--dry-run',
        '--no-interactive',
      ]);
      expect(preview.status).to.equal(1);
      expect(preview.stdout).to.include(
        'Previous merge request remains unconfirmed'
      );
      expect(preview.stdout).not.to.include('✅ Readiness: READY');
      expect(fs.readFileSync(record, 'utf8')).to.equal(saved);
      fs.writeFileSync(gh, original);
      const resumed = fixture.run([
        'land',
        'leaf',
        '--yes',
        '--no-interactive',
      ]);
      expect(resumed.status).to.equal(1);
      expect(resumed.stderr)
        .to.include('No merge is repeated')
        .and.include('An open PR alone');
      const before = JSON.parse(saved);
      const after = JSON.parse(fs.readFileSync(record, 'utf8'));
      // Each invocation records its new owned cache acquisition; operation intent is unchanged.
      delete before.cacheLock;
      delete after.cacheLock;
      expect(after).to.deep.equal(before);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
    });
  }

  it('rechecks PR identity before permitting a later retry after rejection', () => {
    reply(
      { status: '405', message: 'Merge blocked' },
      'gh: Merge blocked (HTTP 405)\n'
    );
    const refused = fixture.run(['land', 'leaf', '--yes', '--no-interactive']);
    expect(refused.status).to.equal(1);
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    prs[0].headRefOid = 'f'.repeat(40);
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(gh, original);
    const remote = fixture.git(['for-each-ref'], github.remote);
    const resumed = fixture.run(['land', 'leaf', '--yes', '--no-interactive']);
    expect(resumed.status).to.equal(1);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
    expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remote);
  });
  it('retains the concrete refusal but keeps uncertainty when fresh merge readback fails', () => {
    const message = 'Merge blocked';
    const body = { status: '405', message };
    const prs = fs.readFileSync(github.state, 'utf8');
    reply(body, `gh: ${message} (HTTP 405)\n`);
    const response = `process.stdout.write(${JSON.stringify(
      JSON.stringify(body)
    )});`;
    fs.writeFileSync(
      gh,
      fs
        .readFileSync(gh, 'utf8')
        .replace(
          response,
          `fs.writeFileSync(${JSON.stringify(github.state)}, '[]');${response}`
        )
    );
    const refused = fixture.run(['land', 'leaf', '--yes', '--no-interactive']);
    expect(refused.status).to.equal(1);
    expect(refused.stderr)
      .to.include('HTTP 405')
      .and.include(message)
      .and.include('Merge readback failed');
    const record = path.join(fixture.repo, '.git', '.anthracite_landing');
    expect(JSON.parse(fs.readFileSync(record, 'utf8')).phase).to.equal(
      'merge-requested'
    );
    fs.writeFileSync(github.state, prs);
    fs.writeFileSync(gh, original);
    const resumed = fixture.run(['land', 'leaf', '--yes', '--no-interactive']);
    expect(resumed.status).to.equal(1);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(1);
  });
});
