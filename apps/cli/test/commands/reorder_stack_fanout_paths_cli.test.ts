import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder protects every off-chain checkout and original replay range', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  function sidePath(name: string, transient = false): void {
    fixture.branch('side', 'base');
    fixture.branch('deep', 'side');
    fs.mkdirSync(path.dirname(path.join(fixture.repo, name)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(fixture.repo, name), 'side contents');
    fixture.git(['add', '--', name]);
    fixture.git(['commit', '-m', 'add offchain path']);
    if (transient) {
      fixture.git(['rm', '--', name]);
      fixture.git(['commit', '-m', 'delete offchain path']);
    }
    fixture.git(['switch', 'child']);
    fixture.editor('base\ntip\nchild\n');
  }
  function refuse(): void {
    const before = fixture.snapshot();
    const parents = fixture.ok(['log', 'short']);
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('overwrite');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.ok(['log', 'short'])).to.equal(parents);
  }
  for (const name of [
    'space name.bin',
    'newline\nname.bin',
    '[literal]*?.bin',
  ]) {
    it(`protects off-chain literal binary path ${JSON.stringify(name)}`, () => {
      sidePath(name);
      const bytes = Buffer.from([255, 0, 13, 128]);
      fs.writeFileSync(path.join(fixture.repo, name), bytes);
      refuse();
      expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
        bytes
      );
    });
  }
  it('protects ignored transient subtree add/delete paths absent from final tips', () => {
    sidePath('transient.bin', true);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'transient.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.bin'),
      Buffer.from([0, 255, 13])
    );
    refuse();
  });
  it('protects an original stale side replay basis even when its own tip deletes the path', () => {
    fixture.git(['switch', 'base']);
    fixture.commit('basis');
    fixture.ok(['restack', '--branch', 'child']);
    fixture.branch('side', 'base');
    fixture.git(['rm', 'basis.txt']);
    fixture.git(['commit', '-m', 'delete basis']);
    fixture.git(['switch', 'base']);
    fixture.git(['rm', 'basis.txt']);
    fixture.git(['commit', '-m', 'remove parent path']);
    fixture.ok(['restack', '--branch', 'child']);
    fixture.git(['switch', 'child']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'basis.txt\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'basis.txt'),
      Buffer.from([0, 255, 13])
    );
    fixture.editor('base\ntip\nchild\n');
    refuse();
  });
  it('protects a directory obstructing an off-chain file', () => {
    sidePath('blocked');
    fs.mkdirSync(path.join(fixture.repo, 'blocked'));
    fs.writeFileSync(
      path.join(fixture.repo, 'blocked', 'mine'),
      Buffer.from([0, 255])
    );
    refuse();
  });
  it('protects a symlink obstructing an off-chain directory', () => {
    sidePath('blocked/inside');
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'mine'), Buffer.from([0, 255]));
    fs.symlinkSync(outside, path.join(fixture.repo, 'blocked'));
    refuse();
    expect(fs.readFileSync(path.join(outside, 'mine'))).to.deep.equal(
      Buffer.from([0, 255])
    );
  });
  for (const [planned, local] of [
    ['Alias.bin', 'alias.bin'],
    ['caf\u00e9.bin', 'cafe\u0301.bin'],
  ]) {
    it(`protects a host-supported subtree alias ${planned}`, function () {
      sidePath(planned);
      fs.writeFileSync(path.join(fixture.repo, local), Buffer.from([0, 255]));
      if (!fs.existsSync(path.join(fixture.repo, planned))) {
        this.skip();
        return;
      }
      refuse();
    });
  }
  it('excludes historical paths before the original subtree replay base and preserves ignored and untracked bytes', () => {
    fixture.git(['switch', 'main']);
    fixture.commit('historical');
    fixture.git(['rm', 'historical.txt']);
    fixture.git(['commit', '-m', 'delete before all replay bases']);
    fixture.branch('history-base', 'main');
    fixture.branch('history-child', 'history-base');
    fixture.branch('history-tip', 'history-child');
    fixture.branch('side', 'history-base');
    fixture.branch('deep', 'side');
    fixture.git(['switch', 'history-child']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'historical.txt\n'
    );
    const bytes = Buffer.from([0, 255, 13, 128]);
    for (const name of ['historical.txt', 'untracked.bin'])
      fs.writeFileSync(path.join(fixture.repo, name), bytes);
    fixture.editor('history-base\nhistory-tip\nhistory-child\n');
    fixture.edit();
    for (const name of ['historical.txt', 'untracked.bin'])
      expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
        bytes
      );
    expect(fixture.parent('deep')).to.equal('side');
  });
});
