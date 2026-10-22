import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

function ignore(fixture: CreateCliFixture, pattern: string): void {
  fs.appendFileSync(
    path.join(fixture.repo, '.git/info/exclude'),
    `\n${pattern}\n`
  );
}
function expectOriginalParents(fixture: CreateCliFixture): void {
  for (const [branch, parent] of [
    ['base', 'main'],
    ['child', 'base'],
    ['tip', 'child'],
  ]) {
    fixture.ok(['checkout', branch]);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
  }
}

// eslint-disable-next-line max-lines-per-function
describe('move only descendant checkout and replay protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  const bytes = Buffer.from([0, 255, 13, 10, 42]);

  for (const ignored of [false, true]) {
    it(`protects ${
      ignored ? 'ignored' : 'untracked'
    } literal work in the target new basis absent from its old tree`, () => {
      const file = ' [draft]*\n.bin';
      fixture.git(['switch', 'main']);
      fixture.stage(file, 'new parent work');
      fixture.git(['commit', '-m', 'new parent work']);
      fixture.git(['switch', 'other']);
      if (ignored) ignore(fixture, '*');
      fs.writeFileSync(path.join(fixture.repo, file), bytes);
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'tip', '-s', 'base', '--only']);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.match(/overwrite/i);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, file))).to.deep.equal(
        bytes
      );
      fs.unlinkSync(path.join(fixture.repo, file));
      expectOriginalParents(fixture);
    });
  }

  for (const branch of ['base', 'child', 'tip']) {
    for (const ignored of [false, true]) {
      it(`protects ${
        ignored ? 'ignored' : 'untracked'
      } intermediate replay work in rotating ${branch}`, () => {
        fixture.git(['switch', branch]);
        fixture.stage('transient.bin', 'temporary own work');
        fixture.git(['commit', '-m', 'temporary add']);
        fixture.git(['rm', 'transient.bin']);
        fixture.git(['commit', '-m', 'temporary remove']);
        fixture.ok(['restack', '--upstack']);
        fixture.git(['switch', 'other']);
        if (ignored) ignore(fixture, 'transient.bin');
        fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
        const before = fixture.snapshot();
        const result = fixture.run(['move', 'tip', '-s', 'base', '--only']);
        expect(result.status).not.to.equal(0);
        expect(result.stdout + result.stderr).to.match(/overwrite/i);
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(
          fs.readFileSync(path.join(fixture.repo, 'transient.bin'))
        ).to.deep.equal(bytes);
        expectOriginalParents(fixture);
      });
    }
  }

  it('allows ignored work touched only before all original rotation replay bases', () => {
    fixture.git(['switch', 'main']);
    fixture.stage('historical.bin', 'historical work');
    fixture.git(['commit', '-m', 'historical add']);
    fixture.git(['rm', 'historical.bin']);
    fixture.git(['commit', '-m', 'historical remove']);
    fixture.branch('new-source', 'main');
    fixture.branch('new-child', 'new-source');
    fixture.branch('new-target', 'new-child');
    fixture.git(['switch', 'other']);
    ignore(fixture, 'historical.bin');
    fs.writeFileSync(path.join(fixture.repo, 'historical.bin'), bytes);
    const unaffected = ['main', 'other', 'base', 'child', 'tip'].map(
      (branch) => [branch, fixture.git(['rev-parse', branch])]
    );
    fixture.ok(['move', 'new-target', '-s', 'new-source', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'historical.bin'))
    ).to.deep.equal(bytes);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..new-source'])
    ).to.equal('new-child\nnew-target\nnew-source');
    expect(fixture.git(['rev-parse', 'new-source^'])).to.equal(
      fixture.git(['rev-parse', 'new-target'])
    );
    for (const [branch, sha] of unaffected)
      expect(fixture.git(['rev-parse', branch])).to.equal(sha);
    for (const [branch, parent] of [
      ['new-source', 'new-target'],
      ['new-target', 'new-child'],
      ['new-child', 'main'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });

  it('protects a symlink ancestor of the rotating target and its external bytes', () => {
    fixture.git(['switch', 'child']);
    fs.mkdirSync(path.join(fixture.repo, 'obstruction'));
    fixture.stage('obstruction/data.bin', 'child own work');
    fixture.git(['commit', '-m', 'child directory']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'data.bin'), bytes);
    fs.symlinkSync(outside, path.join(fixture.repo, 'obstruction'));
    ignore(fixture, '*');
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'tip', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/overwrite/i);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.lstatSync(path.join(fixture.repo, 'obstruction')).isSymbolicLink()
    ).to.equal(true);
    expect(fs.readFileSync(path.join(outside, 'data.bin'))).to.deep.equal(
      bytes
    );
    fs.unlinkSync(path.join(fixture.repo, 'obstruction'));
    expectOriginalParents(fixture);
  });

  for (const ignorecase of [false, true]) {
    it(`protects an ignored Unicode alias in the rotating target with ignorecase ${ignorecase}`, function () {
      fixture.git(['switch', 'child']);
      fixture.stage('É.txt', 'child own work');
      fixture.git(['commit', '-m', 'child Unicode path']);
      fixture.ok(['restack', '--upstack']);
      fixture.git(['switch', 'other']);
      fixture.git(['config', 'core.ignorecase', String(ignorecase)]);
      ignore(fixture, '*');
      fs.writeFileSync(path.join(fixture.repo, 'é.txt'), bytes);
      const overlaps = fs.existsSync(path.join(fixture.repo, 'É.txt'));
      if (!overlaps) this.skip();
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'tip', '-s', 'base', '--only']);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.match(/overwrite/i);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, 'é.txt'))).to.deep.equal(
        bytes
      );
      fs.unlinkSync(path.join(fixture.repo, 'é.txt'));
      expectOriginalParents(fixture);
    });
  }
});
