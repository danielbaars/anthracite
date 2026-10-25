import { expect } from 'chai';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ReorderCliFixture } from '../lib/fixtures/reorder_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack reorder editor and argument contract through public processes', function () {
  this.timeout(120000);
  let fixture: ReorderCliFixture;
  beforeEach(() => {
    fixture = new ReorderCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const departure of ['base', 'tip']) {
    it(`offers all features from ${departure} and returns there with a different new top`, () => {
      fixture.git(['switch', departure]);
      fixture.editor('child\nbase\ntip\n');
      fixture.edit(['ro', '--stack=true', '--stack']);
      expect(
        fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 3)
      ).to.deep.equal(['tip', 'child', 'base']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(departure);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'main..child'])
      ).to.equal('tip\nbase\nchild');
      expect(fixture.parent('tip')).to.equal('main');
      expect(fixture.parent('base')).to.equal('tip');
      expect(fixture.parent('child')).to.equal('base');
    });
  }
  for (const args of [[], ['--stack=false'], ['--stack', 'false']]) {
    it(`keeps ordinary downstack editor and new-top behavior for ${JSON.stringify(
      args
    )}`, () => {
      fixture.git(['switch', 'child']);
      fixture.editor('base\nchild\n');
      fixture.edit(['ro', ...args]);
      expect(
        fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 2)
      ).to.deep.equal(['child', 'base']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }
  for (const args of [[], ['--stack=false']]) {
    it(`retains the ordinary input route ${JSON.stringify(args)}`, () => {
      fixture.git(['switch', 'child']);
      fixture.ok([
        'reorder',
        ...args,
        '--input',
        fixture.input('child\nbase\n'),
      ]);
      expect(fixture.git(['branch', '--show-current'])).to.equal('child');
      expect(fixture.parent('child')).to.equal('base');
    });
  }
  for (const content of [
    '',
    '# only comments\n\n',
    'tip\nchild\nchild\nbase\n',
    'tip\nbase\n',
    'tip\nother\nbase\n',
    'tip\nunknown\nbase\n',
    'tip\nmain\nbase\n',
    'tip\nHEAD~1\nbase\n',
    'tip\nchild # inline\nbase\n',
  ]) {
    it(`rejects the whole invalid editor list ${JSON.stringify(
      content
    )} before effects`, () => {
      const before = fixture.snapshot();
      fixture.editor(content);
      const result = fixture.run(['reorder', '--stack', '--interactive']);
      expect(result.status).not.to.equal(0);
      expect(fs.existsSync(fixture.offered)).to.equal(true);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.parent('base')).to.equal('main');
      expect(fixture.parent('child')).to.equal('base');
      expect(fixture.parent('tip')).to.equal('child');
    });
  }
  for (const content of [
    'tip\nchild\nbase\n',
    '\r\n\t tip \t\r\n# a comment\r\n child\t\r\n \tbase \r\n',
  ]) {
    it(`accepts unchanged UTF-8 LF/CRLF and whitespace input ${JSON.stringify(
      content
    )}`, () => {
      const before = fixture.snapshot();
      fixture.editor(content);
      fixture.edit();
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }
  it('rejects a nonzero editor exit even when the file is a valid permutation', () => {
    const before = fixture.snapshot();
    fixture.editor('base\nchild\ntip\n', '', 19);
    const result = fixture.run(['reorder', '--stack', '--interactive']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
  });
  it('uses literal leading/embedded hashes, apostrophe, shell characters and Unicode names', () => {
    fixture.git(['switch', 'main']);
    const names = ['#first', 'em#bed', "quo'te", '日本$(touch${IFS}PWNED)'];
    let parent = 'main';
    for (const name of names) {
      fixture.branch(name, parent);
      parent = name;
    }
    fixture.git(['switch', '#first']);
    fixture.editor("#first\nem#bed\nquo'te\n日本$(touch${IFS}PWNED)\n");
    fixture.edit();
    expect(
      fs.readFileSync(fixture.offered, 'utf8').split('\n').slice(0, 4)
    ).to.deep.equal([...names].reverse());
    expect(fixture.git(['branch', '--show-current'])).to.equal('#first');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..#first'])
    ).to.equal('____touch__IFS_PWNED_\nquo_te\nem_bed\n_first');
    expect(fs.existsSync(path.join(fixture.repo, 'PWNED'))).to.equal(false);
    expect(fixture.parent('#first')).to.equal('em#bed');
  });
  for (const args of [
    ['--stack='],
    ['--stack', ''],
    ['--stack=bad'],
    ['--stack', 'bad'],
    ['--stack', '--stack=false'],
    ['--stack=false', '--stack'],
    ['--stack=true', '--stack=false'],
    ['--stack', '--force'],
    ['--stack', '--new-option'],
    ['--stack', '--', 'tip'],
  ]) {
    it(`rejects raw ambiguous/unknown arguments ${JSON.stringify(
      args
    )} before editor or effects`, () => {
      const before = fixture.snapshot();
      const result = fixture.run(['reorder', ...args, '--interactive']);
      expect(result.status).not.to.equal(0);
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect(fixture.snapshot()).to.deep.equal(before);
    });
  }
  it('accepts identical false declarations and a terminal argument terminator', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    fixture.git(['switch', 'child']);
    const before = [fixture.git(['rev-parse', 'HEAD']), fixture.refs()];
    const result = fixture.run([
      'reorder',
      '--stack=false',
      '--stack',
      'false',
      '--interactive',
      '--',
    ]);
    expect(result.status, result.stderr).to.equal(0);
    expect(fs.readFileSync(fixture.offered, 'utf8').split('\n')[0]).to.equal(
      'child'
    );
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
    expect([fixture.git(['rev-parse', 'HEAD']), fixture.refs()]).to.deep.equal(
      before
    );
  });
  it('explains scope, top-first ordering and departure return in help', () => {
    const help = fixture.ok(['reorder', '--help']);
    expect(help).to.include('--stack');
    expect(help).to.include('trunk-to-tip');
    expect(help).to.include('top-first');
    expect(help).to.include('departure');
  });
  it('refuses a noninteractive editor, including quiet, but accepts validated stack input', () => {
    delete fixture.env.GIT_OPTIONAL_LOCKS;
    fixture.git(['status', '--porcelain']);
    const before = fixture.snapshot();
    for (const quiet of [[], ['--quiet']]) {
      const result = fixture.run([
        'reorder',
        '--stack',
        '--no-interactive',
        ...quiet,
      ]);
      expect(result.status).to.equal(1);
      expect(result.stdout).to.equal('');
      expect(result.stderr)
        .to.include('requires interactive mode')
        .and.include('supported explicit input file');
      expect(fs.existsSync(fixture.offered)).to.equal(false);
      expect(fixture.snapshot()).to.deep.equal(before);
    }
    fixture.ok([
      'reorder',
      '--stack',
      '--input',
      fixture.input('base\ntip\nchild\n'),
    ]);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.parent('base')).to.equal('tip');
  });
  it('applies the same permutation validation to explicit stack input', () => {
    const before = fixture.snapshot();
    const result = fixture.run([
      'reorder',
      '--stack',
      '--input',
      fixture.input('base\n'),
      '--no-interactive',
    ]);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
  });
  it('preserves literal Unicode whitespace in a valid selected branch name', () => {
    fixture.git(['switch', 'main']);
    fixture.branch('ascii-base', 'main');
    fixture.branch('\u00a0literal\u00a0', 'ascii-base');
    fixture.git(['switch', 'ascii-base']);
    fixture.editor('ascii-base\n\u00a0literal\u00a0\n');
    fixture.edit();
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..ascii-base'])
    ).to.equal('_literal_\nascii-base');
    expect(fixture.parent('ascii-base')).to.equal('\u00a0literal\u00a0');
  });
  it('returns to a departure name containing literal leading and trailing Unicode whitespace', () => {
    fixture.git(['switch', 'main']);
    fixture.branch('ascii-base', 'main');
    fixture.branch('\u00a0literal\u00a0', 'ascii-base');
    fixture.editor('ascii-base\n\u00a0literal\u00a0\n');
    fixture.edit();
    expect(
      execFileSync('git', ['branch', '--show-current'], {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
      })
    ).to.equal('\u00a0literal\u00a0\n');
    expect(fixture.ok(['info'])).to.include('Parent: main');
    fixture.ok(['checkout', 'ascii-base']);
    expect(fixture.ok(['info'])).to.include('Parent: \u00a0literal\u00a0');
  });
});
