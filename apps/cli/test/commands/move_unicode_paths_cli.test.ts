import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move Unicode filesystem path protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('preserves ignored bytes at a Unicode case alias of the target file', function () {
    fixture.git(['switch', 'other']);
    fixture.stage('É.txt', 'tracked target');
    fixture.git(['commit', '-m', 'target Unicode path']);
    fixture.git(['switch', 'base']);
    fixture.git(['config', 'core.ignorecase', 'true']);
    fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
    const bytes = Buffer.from([0, 255, 13, 10, 71]);
    fs.writeFileSync(path.join(fixture.repo, 'é.txt'), bytes);
    if (!fs.existsSync(path.join(fixture.repo, 'É.txt'))) this.skip();
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other', '--only']);
    expect(result.status).not.to.equal(0);
    expect(fs.readFileSync(path.join(fixture.repo, 'é.txt'))).to.deep.equal(
      bytes
    );
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(result.stdout + result.stderr)
      .to.include('ignored')
      .and.include('é.txt');
    fs.unlinkSync(path.join(fixture.repo, 'é.txt'));
    fixture.ok(['checkout', 'child']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
  for (const kind of ['directory', 'file', 'symlink']) {
    it(`preserves an ignored Unicode ${kind} alias in a checkout ancestor`, function () {
      fixture.git(['switch', 'other']);
      fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
      fixture.stage('É-dir/inside.txt', 'target contents');
      fixture.git(['commit', '-m', 'target Unicode directory']);
      fixture.git(['switch', 'base']);
      fixture.git(['config', 'core.ignorecase', 'true']);
      fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
      const bytes = Buffer.from([0, 255, 13, 10, 71]);
      const outside = path.join(fixture.root, 'outside');
      const local = path.join(fixture.repo, 'é-dir');
      if (kind === 'directory') {
        fs.mkdirSync(local);
        fs.writeFileSync(path.join(local, 'inside.txt'), bytes);
      } else if (kind === 'symlink') {
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'inside.txt'), bytes);
        fs.symlinkSync(outside, local);
      } else fs.writeFileSync(local, bytes);
      if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'other', '--only']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(result.stdout + result.stderr)
        .to.include('ignored')
        .and.include('é-dir');
      const saved =
        kind === 'file'
          ? local
          : path.join(kind === 'symlink' ? outside : local, 'inside.txt');
      expect(fs.readFileSync(saved)).to.deep.equal(bytes);
      if (kind === 'symlink') {
        expect(fs.lstatSync(local).isSymbolicLink()).to.equal(true);
        expect(fs.readlinkSync(local)).to.equal(outside);
      }
    });
  }

  it('uses host aliases even when Git ignorecase is false', function () {
    fixture.git(['switch', 'other']);
    fixture.stage('É.txt', 'target contents');
    fixture.git(['commit', '-m', 'target Unicode path']);
    fixture.git(['switch', 'base']);
    fixture.git(['config', 'core.ignorecase', 'false']);
    fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
    const bytes = Buffer.from([0, 255, 13, 10, 71]);
    fixture.write('é.txt', '');
    fs.writeFileSync(path.join(fixture.repo, 'é.txt'), bytes);
    if (!fs.existsSync(path.join(fixture.repo, 'É.txt'))) this.skip();
    const before = fixture.snapshot();
    expect(fixture.run(['move', 'other', '--only']).status).not.to.equal(0);
    expect(fs.readFileSync(path.join(fixture.repo, 'é.txt'))).to.deep.equal(
      bytes
    );
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('allows unrelated ignored work inside a Unicode directory alias', function () {
    fixture.git(['switch', 'other']);
    fs.mkdirSync(path.join(fixture.repo, 'É-dir'));
    fixture.stage('É-dir/new.txt', 'target contents');
    fixture.git(['commit', '-m', 'target Unicode directory']);
    fixture.git(['switch', 'base']);
    fs.mkdirSync(path.join(fixture.repo, 'é-dir'));
    fixture.write('é-dir/private.bin', 'precious unrelated work');
    fs.appendFileSync(path.join(fixture.repo, '.git/info/exclude'), '\n*\n');
    if (!fs.existsSync(path.join(fixture.repo, 'É-dir'))) this.skip();
    fixture.ok(['move', 'other', '--only']);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'é-dir/private.bin'), 'utf8')
    ).to.equal('precious unrelated work');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
});
