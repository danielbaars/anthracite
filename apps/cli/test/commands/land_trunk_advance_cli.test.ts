import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';
import { prepareLand } from '../lib/fixtures/land_gh';

describe('public landing after an external trunk advance', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  let github: ReturnType<typeof prepareLand>;
  beforeEach(() => {
    fixture = new RelationCliFixture();
    github = prepareLand(fixture);
  });
  afterEach(() => fixture?.cleanup());

  function pauseAfterBase(): void {
    const policy = JSON.parse(fs.readFileSync(github.policy, 'utf8'));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, pendingAfterPush: true })
    );
    const paused = fixture.run(['land', 'tip', '--yes', '--wait-timeout', '0']);
    expect(paused.status, paused.stdout + paused.stderr).to.equal(1);
    expect(paused.stderr).to.include('Check wait timed out before #18');
    const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
    for (const pr of prs) {
      pr.statusCheckRollup = [];
      pr.mergeStateStatus = 'CLEAN';
    }
    fs.writeFileSync(github.state, JSON.stringify(prs));
    fs.writeFileSync(
      github.policy,
      JSON.stringify({ ...policy, preserveBaseSnapshot: true })
    );
  }

  it('resumes the ready saved chain after a colleague advances trunk while GitHub retains the PR base snapshot', () => {
    pauseAfterBase();
    const oldTrunk = fixture.git(['rev-parse', 'main']);
    const colleague = path.join(fixture.root, 'colleague');
    fixture.git(['clone', '--branch', 'main', github.remote, colleague]);
    fixture.git(['config', 'user.name', 'Colleague'], colleague);
    fixture.git(['config', 'user.email', 'colleague@example.test'], colleague);
    fs.writeFileSync(
      path.join(colleague, 'colleague.txt'),
      'Preserve the colleague change.\n'
    );
    fixture.git(['add', 'colleague.txt'], colleague);
    fixture.git(['commit', '-m', 'Independent colleague change'], colleague);
    fixture.git(['push', 'origin', 'main'], colleague);
    const newTrunk = fixture.git(['rev-parse', 'main'], github.remote);
    expect(newTrunk).not.to.equal(oldTrunk);
    const before = fixture.inspectionSnapshot();
    const preview = fixture.run(['land', 'tip', '--dry-run']);
    expect(preview.status, preview.stdout + preview.stderr).to.equal(0);
    expect(preview.stdout).to.include('Readiness: READY');
    expect(fixture.inspectionSnapshot()).to.deep.equal(before);
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8'))[1].baseRefOid
    ).to.equal(oldTrunk);

    const resumed = fixture.run(['land', 'tip', '--yes']);
    expect(resumed.status, resumed.stdout + resumed.stderr).to.equal(0);
    expect(fixture.git(['show', 'main:colleague.txt'])).to.equal(
      'Preserve the colleague change.'
    );
    expect(fixture.git(['show', 'main:child.txt'])).to.equal('child');
    expect(fixture.git(['show', 'main:tip.txt'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'main'])).to.equal(
      fixture.git(['rev-parse', 'main'], github.remote)
    );
    expect(
      JSON.parse(fs.readFileSync(github.state, 'utf8')).map(
        (pr: { state: string }) => pr.state
      )
    ).to.deep.equal(['MERGED', 'MERGED', 'MERGED']);
    expect(
      fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
    ).to.equal(3);
  });

  for (const source of ['unrelated', 'missing']) {
    it(`rejects a ${source} PR base snapshot in preview and application without another merge`, () => {
      pauseAfterBase();
      const prs = JSON.parse(fs.readFileSync(github.state, 'utf8'));
      prs[1].baseRefOid =
        source === 'unrelated'
          ? fixture.git(['rev-parse', 'other'])
          : 'f'.repeat(40);
      fs.writeFileSync(github.state, JSON.stringify(prs));
      assertRefusedWithoutEffects('PR base snapshot is not an ancestor');
    });
  }

  it('rejects a divergent local trunk in preview and application without another merge', () => {
    pauseAfterBase();
    fixture.git(['checkout', 'main']);
    fs.writeFileSync(
      path.join(fixture.repo, 'local-trunk.txt'),
      'Local trunk work.\n'
    );
    fixture.git(['add', 'local-trunk.txt']);
    fixture.git(['commit', '-m', 'Preserve local trunk work']);
    fixture.git(['checkout', 'tip']);
    assertRefusedWithoutEffects('local trunk divergent');
  });

  it('rejects a rewound remote trunk in preview and application without another merge', () => {
    pauseAfterBase();
    const record = JSON.parse(
      fs.readFileSync(
        path.join(fixture.repo, '.git/.anthracite_landing'),
        'utf8'
      )
    );
    fixture.git(
      ['update-ref', 'refs/heads/main', record.trunkHead],
      github.remote
    );
    assertRefusedWithoutEffects('local trunk divergent');
  });

  function assertRefusedWithoutEffects(message: string): void {
    const before = fixture.inspectionSnapshot();
    const remoteRefs = fixture.git(['for-each-ref'], github.remote);
    const recoveryFile = path.join(fixture.repo, '.git/.anthracite_landing');
    const { cacheLock: beforeLock, ...beforeRecovery } = JSON.parse(
      fs.readFileSync(recoveryFile, 'utf8')
    );
    for (const option of ['--dry-run', '--yes']) {
      const refused = fixture.run(['land', 'tip', option]);
      expect(refused.status, refused.stdout + refused.stderr).to.equal(1);
      expect(refused.stdout + refused.stderr).to.include(message);
      expect(refused.stdout).not.to.include('Readiness: READY');
      if (option === '--dry-run')
        expect(fixture.inspectionSnapshot()).to.deep.equal(before);
      expect(fixture.git(['for-each-ref'], github.remote)).to.equal(remoteRefs);
      expect(
        fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']) +
          '\n'
      ).to.equal(before.refs);
      expect(
        fs.readFileSync(github.calls, 'utf8').split('"PUT"').length - 1
      ).to.equal(1);
      const { cacheLock: afterLock, ...afterRecovery } = JSON.parse(
        fs.readFileSync(recoveryFile, 'utf8')
      );
      expect(afterRecovery).to.deep.equal(beforeRecovery);
    }
  }
});
