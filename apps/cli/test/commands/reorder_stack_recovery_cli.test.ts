import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('linear reorder own work and first conflict recovery through fresh processes', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  it('keeps ordered multiple own commits at every level without merge or helper commits', () => {
    for (const name of ['base', 'child', 'tip']) {
      fixture.git(['switch', name]);
      fixture.commit(`${name}-second`);
      fixture.ok(['restack', '--branch', name]);
    }
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
    fixture.edit();
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('child\nchild-second\ntip\ntip-second\nbase\nbase-second');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..child'])
    ).to.equal('child\nchild-second');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'child..tip'])
    ).to.equal('tip\ntip-second');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'tip..base'])
    ).to.equal('base\nbase-second');
    expect(fixture.git(['rev-list', '--merges', 'main..base'])).to.equal('');
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });
  for (const withWork of ['none', 'e-base', 'e-middle', 'e-tip']) {
    it(`preserves empty bottom/middle/tip identities with work at ${withWork}`, () => {
      let parent = 'main';
      for (const name of ['e-base', 'e-middle', 'e-tip']) {
        fixture.branch(name, parent, true);
        if (name === withWork) fixture.commit('own');
        parent = name;
      }
      fixture.git(['switch', 'e-middle']);
      fixture.editor('e-base\ne-tip\ne-middle\n');
      fixture.edit();
      expect(fixture.parent('e-middle')).to.equal('main');
      expect(fixture.parent('e-tip')).to.equal('e-middle');
      expect(fixture.parent('e-base')).to.equal('e-tip');
      expect(fixture.git(['branch', '--show-current'])).to.equal('e-middle');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..e-base'])
      ).to.equal(withWork === 'none' ? '' : 'own');
      expect(
        fixture
          .git(['branch', '--list', 'e-*'])
          .replace(/\*/g, '')
          .trim()
          .split('\n')
          .map((line) => line.trim())
      ).to.deep.equal(['e-base', 'e-middle', 'e-tip']);
    });
  }
  it('keeps an isolated feature a true no-op through the actual editor', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    fixture.edit();
    expect(fs.readFileSync(fixture.offered, 'utf8').split('\n')[0]).to.equal(
      'other'
    );
    expect(fixture.snapshot()).to.deep.equal(before);
  });
  function conflict(): string {
    fixture.git(['switch', 'main']);
    fixture.branch('conflict-base', 'main', true);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base version');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'base own']);
    fixture.branch('conflict-child', 'conflict-base', true);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child version');
    fixture.git(['add', 'main.txt']);
    fixture.git(['commit', '-m', 'child own']);
    fixture.git(['switch', 'conflict-base']);
    fixture.editor('conflict-base\nconflict-child\n');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('ch continue');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(true);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    return result.stdout + result.stderr;
  }
  it('resolves real conflicts with fresh info/log/continue processes and returns to departure', () => {
    conflict();
    expect(fixture.ok(['info'])).to.include('conflict-base');
    expect(fixture.ok(['log'])).to.include('conflict-child');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'child version');
    fixture.git(['add', 'main.txt']);
    const next = fixture.run(['continue', '--no-interactive']);
    expect(next.status).not.to.equal(0);
    expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'base version');
    fixture.git(['add', 'main.txt']);
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('conflict-base');
    expect(fixture.parent('conflict-child')).to.equal('main');
    expect(fixture.parent('conflict-base')).to.equal('conflict-child');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..conflict-base'])
    ).to.equal('child own\nbase own');
    expect(fixture.git(['show', 'conflict-child:main.txt'])).to.equal(
      'child version'
    );
    expect(fixture.git(['show', 'conflict-base:main.txt'])).to.equal(
      'base version'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
  });
  it('executes the public raw abort, retains published parents and refuses continue without a rebase', () => {
    const before = fixture.refs();
    const output = conflict();
    expect(output).to.include('ch rebase --abort');
    const abortedResult = fixture.run(['rebase', '--abort']);
    expect(abortedResult.status).to.equal(0);
    expect(fixture.parent('conflict-child')).to.equal('main');
    expect(fixture.parent('conflict-base')).to.equal('conflict-child');
    const aborted = fixture.snapshot();
    const continuation = fixture.run(['continue', '--no-interactive']);
    expect(continuation.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(aborted);
    expect(fixture.refs()).not.to.equal(before);
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
