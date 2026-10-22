import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move path protection through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function ignore(file: string): void {
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), `\n${file}\n`);
  }

  for (const ignored of [false, true]) {
    it(`protects an explicit source checkout collision, ignored ${ignored}`, () => {
      fixture.git(['switch', 'other']);
      if (ignored) ignore('base.txt');
      const bytes = Buffer.from([0, 201, 10, 222]);
      fs.writeFileSync(path.join(fixture.repo, 'base.txt'), bytes);
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'main', '--source', 'base']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'base.txt'))
      ).to.deep.equal(bytes);
      fs.unlinkSync(path.join(fixture.repo, 'base.txt'));
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });

    it(`protects a target checkout collision, ignored ${ignored}`, () => {
      if (ignored) ignore('other.txt');
      fixture.write('other.txt', 'private target collision');
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'other']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'other.txt'), 'utf8')
      ).to.equal('private target collision');
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  for (const branch of ['base', 'child']) {
    it(`protects intermediate add/delete replay paths in ${branch}`, () => {
      fixture.git(['switch', branch]);
      fixture.stage('transient.bin', 'replayed intermediate file');
      fixture.git(['commit', '-m', 'add intermediate path']);
      fixture.git(['rm', 'transient.bin']);
      fixture.git(['commit', '-m', 'remove intermediate path']);
      fixture.git(['switch', 'base']);
      ignore('transient.bin');
      const bytes = Buffer.from([0, 255, 10, 33]);
      fs.writeFileSync(path.join(fixture.repo, 'transient.bin'), bytes);
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'other']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, 'transient.bin'))
      ).to.deep.equal(bytes);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('allows a path touched only before the recorded replay base', () => {
    fixture.git(['switch', 'main']);
    fixture.stage('old-only.bin', 'old historical path');
    fixture.git(['commit', '-m', 'old path add']);
    fixture.git(['rm', 'old-only.bin']);
    fixture.git(['commit', '-m', 'old path remove']);
    fixture.branch('history-source', 'main');
    ignore('old-only.bin');
    const bytes = Buffer.from([1, 255, 0, 10]);
    fs.writeFileSync(path.join(fixture.repo, 'old-only.bin'), bytes);
    fixture.ok(['move', 'other']);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'old-only.bin'))
    ).to.deep.equal(bytes);
    expect(
      fixture.git(['log', '--format=%s', 'other..history-source'])
    ).to.equal('history-source');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  for (const name of ['literal[ab]*?.txt', 'line\nbreak.txt', ' leading.txt']) {
    it(`protects a literal ignored target path ${JSON.stringify(name)}`, () => {
      fixture.git(['switch', 'other']);
      fixture.stage(name, 'committed target path');
      fixture.git(['commit', '-m', 'literal target path']);
      fixture.git(['switch', 'base']);
      ignore('*');
      fixture.write(name, 'ignored literal content');
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'other']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(path.join(fixture.repo, name), 'utf8')).to.equal(
        'ignored literal content'
      );
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('protects an ignored directory obstructing a target file', () => {
    fs.mkdirSync(path.join(fixture.repo, 'other.txt'));
    ignore('other.txt/');
    fixture.write('other.txt/private.bin', 'nested ignored content');
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'other.txt/private.bin'), 'utf8')
    ).to.equal('nested ignored content');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('protects an ignored file obstructing a target directory', () => {
    fixture.git(['switch', 'other']);
    fs.mkdirSync(path.join(fixture.repo, 'target-dir'));
    fixture.stage('target-dir/file.txt', 'target nested work');
    fixture.git(['commit', '-m', 'target directory']);
    fixture.git(['switch', 'base']);
    ignore('target-dir');
    fixture.write('target-dir', 'ignored obstruction');
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'target-dir'), 'utf8')
    ).to.equal('ignored obstruction');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('protects a symlink ancestor and the external content it points to', () => {
    fixture.git(['switch', 'other']);
    fs.mkdirSync(path.join(fixture.repo, 'target-dir'));
    fixture.stage('target-dir/file.txt', 'target nested work');
    fixture.git(['commit', '-m', 'target directory']);
    fixture.git(['switch', 'base']);
    const outside = path.join(fixture.root, 'external');
    fs.mkdirSync(outside);
    fs.writeFileSync(
      path.join(outside, 'file.txt'),
      'external private content'
    );
    fs.symlinkSync(outside, path.join(fixture.repo, 'target-dir'));
    ignore('target-dir');
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.readlinkSync(path.join(fixture.repo, 'target-dir'))).to.equal(
      outside
    );
    expect(fs.readFileSync(path.join(outside, 'file.txt'), 'utf8')).to.equal(
      'external private content'
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('protects a relevant ignored case variant when core.ignorecase is enabled', () => {
    fixture.git(['config', 'core.ignorecase', 'true']);
    ignore('OTHER.TXT');
    fixture.write('OTHER.TXT', 'case variant private work');
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'OTHER.TXT'), 'utf8')
    ).to.equal('case variant private work');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
});
