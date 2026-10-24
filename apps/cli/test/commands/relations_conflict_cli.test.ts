import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { RelationCliFixture } from '../lib/fixtures/relation_cli';

// eslint-disable-next-line max-lines-per-function
describe('relation inspection during a real own conflictrebase', function () {
  this.timeout(120000);
  let fixture: RelationCliFixture;
  beforeEach(() => {
    fixture = new RelationCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function prepare(): void {
    fixture.git(['switch', 'main']);
    fixture.commit('stable');
    fixture.branch('conflict-base', 'main', true);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base version');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child version');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
  }

  function expectReplay(branch: string): void {
    expect(fixture.git(['branch', '--show-current'])).to.equal('');
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    const headName = path.resolve(
      fixture.repo,
      fixture.git(['rev-parse', '--git-path', 'rebase-merge/head-name'])
    );
    expect(fs.readFileSync(headName, 'utf8')).to.equal(
      `refs/heads/${branch}\n`
    );
  }

  function inspectDeparture(): void {
    const before = fixture.inspectionSnapshot();
    for (const [command, output] of [
      ['parent', 'conflict-child\n'],
      ['children', ''],
    ]) {
      for (const flags of [
        [],
        ['-q'],
        ['--no-interactive'],
        ['--interactive'],
      ]) {
        const result = fixture.run([command, ...flags]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.equal(flags.includes('-q') ? '' : output);
        expect(result.stderr).to.equal('');
        expectUnchanged(before, `${command} ${flags.join(' ')}`);
      }
      for (const flags of [['--wrong'], ['-q', '--', 'other']]) {
        const result = fixture.run([command, ...flags]);
        expect(result.status).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).not.to.equal('');
        expectUnchanged(before, `${command} ${flags.join(' ')}`);
      }
    }
  }

  function expectUnchanged(
    before: Record<string, unknown>,
    label: string
  ): void {
    const after = fixture.inspectionSnapshot();
    if (process.env.CHARCOAL_TEST_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.CHARCOAL_TEST_EVIDENCE_DIR, { recursive: true });
      fs.appendFileSync(
        path.join(
          process.env.CHARCOAL_TEST_EVIDENCE_DIR,
          `${path.basename(fixture.root)}-inspection.jsonl`
        ),
        JSON.stringify({ label, before, after }) + '\n'
      );
    }
    expect(after, label).to.deep.equal(before);
  }

  function expectNoSubject(): void {
    const before = fixture.inspectionSnapshot();
    for (const command of ['parent', 'children']) {
      for (const flags of [[], ['-q']]) {
        const result = fixture.run([command, ...flags]);
        expect(result.status).to.equal(1);
        expect(result.stdout).to.equal('');
        expect(result.stderr).to.include('ERROR:');
        expectUnchanged(before, `${command} ${flags.join(' ')}`);
      }
    }
  }

  function resolve(contents: string): void {
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), contents);
    fixture.git(['add', 'main.txt']);
  }

  it('rejects ordinary detached HEAD for both queries without changing state', () => {
    fixture.git(['switch', '--detach', 'child']);
    expectNoSubject();
  });

  it('rejects a real Git-initiated conflictrebase without own continuation', () => {
    prepare();
    expect(() =>
      fixture.git([
        'rebase',
        '--onto',
        'main',
        'conflict-base',
        'conflict-child',
      ])
    ).to.throw();
    expectReplay('conflict-child');
    expectNoSubject();
    resolve('child version');
    fixture.env.GIT_EDITOR = 'true';
    fixture.git(['rebase', '--continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(
      'conflict-child'
    );
    expect(
      fixture.git(['log', '--format=%s', 'main..conflict-child'])
    ).to.equal('child own');
  });

  for (const scenario of ['different onto', 'same onto', 'same replay']) {
    it(`rejects stale own context during an unrelated raw Git conflict with ${scenario}`, () => {
      fixture.git(['switch', 'main']);
      fixture.git(['switch', '-c', 'raw-X']);
      resolve('raw X');
      fixture.git(['commit', '-m', 'raw X']);
      fixture.git(['switch', '-c', 'raw-Y']);
      resolve('raw Y');
      fixture.git(['commit', '-m', 'raw Y']);
      fixture.git(['switch', '-c', 'raw-target', 'main']);
      resolve('raw target');
      fixture.git(['commit', '-m', 'raw target']);
      prepare();
      fixture.editor('conflict-base\nconflict-child\n');
      expect(
        fixture.run(['reorder', '--stack', '--interactive']).status
      ).to.equal(1);
      expectReplay('conflict-child');
      fixture.git(['rebase', '--abort']);
      const isSameReplay = scenario === 'same replay';
      expect(() =>
        fixture.git([
          'rebase',
          '--onto',
          scenario === 'different onto' ? 'raw-target' : 'main',
          isSameReplay ? 'conflict-base' : 'raw-X',
          isSameReplay ? 'conflict-child' : 'raw-Y',
        ])
      ).to.throw();
      expectReplay(isSameReplay ? 'conflict-child' : 'raw-Y');
      expectNoSubject();
      resolve(isSameReplay ? 'child version' : 'raw Y');
      expectNoSubject();
      fixture.env.GIT_EDITOR = 'true';
      fixture.git(['rebase', '--continue']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        isSameReplay ? 'conflict-child' : 'raw-Y'
      );
    });
  }

  it('rejects a logical departure removed through ordinary Git without repairing recovery', () => {
    prepare();
    fixture.editor('conflict-base\nconflict-child\n');
    expect(
      fixture.run(['reorder', '--stack', '--interactive']).status
    ).to.equal(1);
    expectReplay('conflict-child');
    fixture.git(['branch', '-D', 'conflict-base']);
    expectNoSubject();
  });

  it('inspects departure instead of the replay branch and resumes both real conflicts in fresh processes', () => {
    prepare();
    fixture.editor('conflict-base\nconflict-child\n');
    const first = fixture.run(['reorder', '--stack', '--interactive']);
    expect(first.status).to.equal(1);
    expect(first.stdout + first.stderr).to.include('ch continue');
    expectReplay('conflict-child');
    fs.utimesSync(
      path.join(fixture.repo, 'stable.txt'),
      new Date(),
      new Date(Date.now() + 5000)
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', '.graphite_cache_lock'),
      'foreign coordination'
    );
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'ignored.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'ignored.bin'),
      Buffer.from([0, 255, 128])
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'untracked.bin'),
      Buffer.from([255, 0, 13, 10])
    );
    fs.symlinkSync('untracked.bin', path.join(fixture.repo, 'untracked-link'));
    inspectDeparture();
    resolve('child version');
    inspectDeparture();
    fs.unlinkSync(path.join(fixture.repo, '.git', '.graphite_cache_lock'));
    // Refresh the deliberately stale clean stat after proving query preservation.
    fixture.git(['update-index', '--refresh']);
    const second = fixture.run(['continue', '--no-interactive']);
    expect(second.status, second.stdout + second.stderr).to.equal(1);
    expect(second.stdout + second.stderr).to.include('conflict-base');
    expectReplay('conflict-base');
    inspectDeparture();
    resolve('base version');
    inspectDeparture();
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(fixture.run(['parent']).stdout).to.equal('conflict-child\n');
    expect(fixture.run(['children']).stdout).to.equal('');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(fixture.git(['show', 'conflict-child:main.txt'])).to.equal(
      'child version'
    );
    expect(fixture.git(['show', 'conflict-base:main.txt'])).to.equal(
      'base version'
    );
    expect(
      fixture.git(['rev-list', '--merges', 'main..conflict-base'])
    ).to.equal('');
    expect(fixture.git(['diff', '--exit-code'])).to.equal('');
    expect(fixture.git(['diff', '--cached', '--exit-code'])).to.equal('');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
  });
});
