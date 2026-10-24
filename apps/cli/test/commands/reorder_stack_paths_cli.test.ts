import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder literal paths and linked indexes through public CLI', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  function addChildPath(name: string, transient = false): void {
    fixture.git(['switch', 'child']);
    fs.mkdirSync(path.dirname(path.join(fixture.repo, name)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(fixture.repo, name), 'selected contents');
    fixture.git(['add', '--', name]);
    fixture.git(['commit', '-m', 'add literal path']);
    if (transient) {
      fixture.git(['rm', '--', name]);
      fixture.git(['commit', '-m', 'remove transient path']);
    }
    fixture.ok(['restack', '--branch', 'child']);
    fixture.git(['switch', 'base']);
    fixture.editor('base\ntip\nchild\n');
  }
  function refuse(): void {
    const parents = fixture.ok(['log', 'short']);
    const before = fixture.snapshot();
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.ok(['log', 'short'])).to.equal(parents);
  }
  for (const name of ['with space.bin', 'with\nnewline.bin', '[glob]*?.bin']) {
    it(`protects exact binary bytes for the literal path ${JSON.stringify(
      name
    )}`, () => {
      addChildPath(name);
      fs.writeFileSync(
        path.join(fixture.repo, name),
        Buffer.from([0, 255, 128, 10])
      );
      refuse();
      expect(fs.readFileSync(path.join(fixture.repo, name))).to.deep.equal(
        Buffer.from([0, 255, 128, 10])
      );
    });
  }
  it('protects a temporarily replayed add/delete path missing from every final tip', () => {
    addChildPath('transient.bin', true);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'transient.bin\n'
    );
    fs.writeFileSync(
      path.join(fixture.repo, 'transient.bin'),
      Buffer.from([0, 255, 12])
    );
    refuse();
  });
  it('protects a directory obstructing a future file checkout', () => {
    addChildPath('obstruction');
    fs.mkdirSync(path.join(fixture.repo, 'obstruction'));
    fs.writeFileSync(
      path.join(fixture.repo, 'obstruction', 'mine'),
      Buffer.from([0, 255])
    );
    refuse();
  });
  it('protects a symlink obstructing a future directory without following it', () => {
    addChildPath('obstruction/inside');
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'mine'), Buffer.from([255, 0, 13]));
    fs.symlinkSync(outside, path.join(fixture.repo, 'obstruction'));
    refuse();
    expect(fs.readFileSync(path.join(outside, 'mine'))).to.deep.equal(
      Buffer.from([255, 0, 13])
    );
    expect(fs.readlinkSync(path.join(fixture.repo, 'obstruction'))).to.equal(
      outside
    );
  });
  for (const [planned, local] of [
    ['Alias.txt', 'alias.txt'],
    ['caf\u00e9.txt', 'cafe\u0301.txt'],
  ]) {
    it(`protects host-supported case/Unicode aliases for ${planned}`, function () {
      addChildPath(planned);
      fs.writeFileSync(
        path.join(fixture.repo, local),
        Buffer.from([255, 0, 13])
      );
      if (!fs.existsSync(path.join(fixture.repo, planned))) {
        this.skip();
        return;
      }
      refuse();
      expect(fs.readFileSync(path.join(fixture.repo, local))).to.deep.equal(
        Buffer.from([255, 0, 13])
      );
    });
  }
  it('ignores removed historical paths before the real own replay boundary', () => {
    fixture.git(['switch', 'main']);
    fixture.commit('historical');
    fixture.git(['rm', 'historical.txt']);
    fixture.git(['commit', '-m', 'remove before replay basis']);
    fixture.branch('new-base', 'main');
    fixture.branch('new-child', 'new-base');
    fixture.branch('new-tip', 'new-child');
    fixture.git(['switch', 'new-base']);
    fs.writeFileSync(
      path.join(fixture.repo, '.git', 'info', 'exclude'),
      'historical.txt\n'
    );
    const bytes = Buffer.from([0, 255, 13]);
    fs.writeFileSync(path.join(fixture.repo, 'historical.txt'), bytes);
    fixture.editor('new-base\nnew-tip\nnew-child\n');
    fixture.edit();
    expect(
      fs.readFileSync(path.join(fixture.repo, 'historical.txt'))
    ).to.deep.equal(bytes);
  });
  it('rejects a selected branch occupied elsewhere before changing either worktree or parents', () => {
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'tip']);
    fs.writeFileSync(path.join(linked, 'tip.txt'), 'linked dirty work');
    fixture.git(['add', 'tip.txt'], linked);
    fs.appendFileSync(path.join(linked, 'tip.txt'), '\npartial work');
    const before = fixture.snapshot(linked);
    fixture.editor('base\ntip\nchild\n');
    refuse();
    expect(fixture.snapshot(linked)).to.deep.equal(before);
  });
  it('rejects a parent-only empty branch occupied elsewhere even with equal SHA', () => {
    fixture.branch('empty-base', 'main', true);
    fixture.branch('empty-child', 'empty-base', true);
    fixture.branch('empty-tip', 'empty-child', true);
    fixture.git(['switch', 'empty-base']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'empty-child']);
    const before = fixture.snapshot(linked);
    const active = fixture.snapshot();
    fixture.editor('empty-base\nempty-tip\nempty-child\n');
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('empty-child');
    expect(fixture.snapshot(linked)).to.deep.equal(before);
    expect(fixture.snapshot()).to.deep.equal(active);
  });
  it('allows a truly unchanged selected base elsewhere with its dirty work and raw index intact', () => {
    fixture.git(['switch', 'child']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'base']);
    fs.writeFileSync(path.join(linked, 'base.txt'), 'linked dirty work');
    const before = fixture.snapshot(linked);
    const base = fixture.git(['rev-parse', 'base']);
    fixture.editor('child\ntip\nbase\n');
    fixture.edit();
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    // Shared changed refs are observed separately; this worktree's HEAD/index/bytes stay intact.
    const after = fixture.snapshot(linked);
    if (
      typeof before !== 'object' ||
      !before ||
      typeof after !== 'object' ||
      !after
    )
      throw new Error('Invalid snapshot');
    expect({ ...after, refs: '' }).to.deep.equal({ ...before, refs: '' });
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });
  it('allows a read-only dirty trunk worktree and executes from its own linked worktree', () => {
    fixture.git(['switch', 'main']);
    fs.writeFileSync(path.join(fixture.repo, 'main.txt'), 'dirty trunk');
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'child']);
    const before = fixture.index();
    const bytes = fs.readFileSync(path.join(fixture.repo, 'main.txt'));
    fixture.editor('base\ntip\nchild\n');
    fixture.edit(['reorder', '--stack'], linked);
    expect(fixture.git(['branch', '--show-current'], linked)).to.equal('child');
    expect(fixture.index()).to.equal(before);
    expect(fs.readFileSync(path.join(fixture.repo, 'main.txt'))).to.deep.equal(
      bytes
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
  it('allows a truly unchanged upper selected branch whose empty ancestors keep its real replay base', () => {
    fixture.branch('e-base', 'main', true);
    fixture.branch('e-work', 'e-base');
    fixture.branch('e-empty', 'e-work', true);
    fixture.branch('e-top', 'e-empty');
    fixture.git(['switch', 'e-work']);
    const linked = path.join(fixture.root, 'linked');
    fixture.git(['worktree', 'add', linked, 'e-top']);
    fs.writeFileSync(path.join(linked, 'e-top.txt'), 'upper dirty work');
    const before = fixture.snapshot(linked);
    const tip = fixture.git(['rev-parse', 'e-top']);
    const untracked = Buffer.from([255, 0, 13]);
    fs.writeFileSync(path.join(fixture.repo, 'e-top.txt'), untracked);
    fixture.editor('e-top\ne-empty\ne-base\ne-work\n');
    fixture.edit();
    expect(fixture.git(['rev-parse', 'e-top'])).to.equal(tip);
    expect(fs.readFileSync(path.join(fixture.repo, 'e-top.txt'))).to.deep.equal(
      untracked
    );
    expect({ ...fixture.snapshot(linked), refs: '' }).to.deep.equal({
      ...before,
      refs: '',
    });
    expect(fixture.parent('e-work')).to.equal('main');
    expect(fixture.parent('e-base')).to.equal('e-work');
    expect(fixture.parent('e-empty')).to.equal('e-base');
    expect(fixture.git(['branch', '--show-current'])).to.equal('e-work');
  });
});
