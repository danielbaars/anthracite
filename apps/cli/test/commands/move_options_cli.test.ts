import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move options through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('moves the whole stack with onto and preserves its own commit ranges', () => {
    const other = fixture.git(['rev-parse', 'other']);
    fixture.ok(['move', '--onto', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'base'],
      ['tip', 'child'],
    ]) {
      expect(fixture.git(['merge-base', branch, parent])).to.equal(
        fixture.git(['rev-parse', parent])
      );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${branch}`])
      ).to.equal(branch);
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
    expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
  });
  it('moves only a leaf without changing unrelated refs or making a synthetic commit', () => {
    const refs = ['main', 'base', 'child', 'other'].map((branch) =>
      fixture.git(['rev-parse', branch])
    );
    fixture.git(['switch', 'tip']);
    fixture.ok(['move', 'other', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(
      ['main', 'base', 'child', 'other'].map((branch) =>
        fixture.git(['rev-parse', branch])
      )
    ).to.deep.equal(refs);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('tip');
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'main.txt\nother.txt\ntip.txt'
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('accepts short source and onto options and returns to the original checkout', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['move', '-s', 'base', '-o', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('rejects conflicting positional and explicit targets before changing the departure or public parents', () => {
    fixture.git(['switch', 'tip']);
    const before = fixture.snapshot();
    const result = fixture.run([
      'move',
      'main',
      '--onto',
      'other',
      '--source',
      'base',
    ]);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('accepts identical repeated explicit values and an identical positional target', () => {
    fixture.git(['switch', 'main']);
    fixture.ok([
      'move',
      'other',
      '--onto',
      'other',
      '-o',
      'other',
      '--source',
      'base',
      '-s',
      'base',
    ]);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  for (const args of [
    ['move', 'other'],
    ['move', '--onto', 'other'],
    ['move', '-o', 'other'],
    ['move', 'other', '--onto', 'other'],
    ['move', '-o', 'other', '--only=false'],
  ]) {
    it(`preserves ordinary fan-out semantics for ${args.join(' ')}`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('sibling-tip', 'sibling');
      fixture.git(['switch', 'base']);
      fixture.ok(args);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      for (const [branch, parent] of [
        ['base', 'other'],
        ['child', 'base'],
        ['tip', 'child'],
        ['sibling', 'base'],
        ['sibling-tip', 'sibling'],
      ]) {
        expect(
          fixture.git(['log', '--format=%s', `${parent}..${branch}`])
        ).to.equal(branch);
        expect(fixture.git(['merge-base', branch, parent])).to.equal(
          fixture.git(['rev-parse', parent])
        );
        fixture.ok(['checkout', branch]);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      }
    });
  }

  for (const args of [
    ['move', 'other', '--onto', 'main'],
    ['move', '--onto', ''],
    ['move', '--onto'],
    ['move', '-o'],
    ['move', ''],
    ['move', '--source', ''],
    ['move', '--source'],
    ['move', '-s'],
    ['move', '--onto', 'other', '--onto', 'main'],
    ['move', '--onto', 'other', '-o', 'main'],
    ['move', 'other', '--source', 'base', '--source', 'tip'],
    ['move', 'other', '--source', 'base', '-s', 'tip'],
    ['move', '--onto', 'other', '-s', ''],
    ['move', '--source', 'base'],
    ['move'],
  ]) {
    it(`rejects invalid or non-interactive incomplete input ${JSON.stringify(
      args
    )} before mutation`, () => {
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      const result = fixture.run(args);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).not.to.match(/Choose a new base/);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }

  it('describes the target, selected source and only scopes in public help', () => {
    const output = fixture.ok(['move', '--help']);
    expect(output)
      .to.include('--onto')
      .and.include('-o,')
      .and.include('--source')
      .and.include('-s,')
      .and.include('--only');
    expect(output)
      .to.match(/whole upstack/)
      .and.match(/source/);
  });

  for (const departure of ['main', 'untracked', 'tip']) {
    it(`returns ordinary explicit-source success to ${departure} without changing its tracking status`, () => {
      if (departure === 'untracked')
        fixture.git(['branch', departure, 'other']);
      fixture.git(['switch', departure]);
      const original = fixture.git(['rev-parse', departure]);
      fixture.ok(['move', '--onto', 'other', '--source', 'base']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(departure);
      if (departure === 'tip') {
        expect(fixture.git(['rev-parse', 'tip'])).not.to.equal(original);
        expect(fixture.git(['show', 'tip:other.txt'])).to.equal('other');
      } else expect(fixture.git(['rev-parse', departure])).to.equal(original);
      if (departure === 'untracked') {
        const result = fixture.run(['down']);
        expect(result.status).not.to.equal(0);
        expect(result.stdout + result.stderr).to.match(
          /untracked branch untracked/i
        );
      }
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    });
  }

  it('allows a leaf source even when the departure branch itself has children', () => {
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    fixture.ok(['move', '--onto', 'other', '--source', 'tip', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['log', '--format=%s', 'other..tip'])).to.equal('tip');
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('rejects child-bearing only based on the selected source rather than the leaf departure', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = fixture.run([
      'move',
      '--onto',
      'other',
      '--source',
      'base',
      '--only',
    ]);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.match(/only.*without children/);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('moves an empty only leaf and keeps an aligned ordinary move a no-op', () => {
    const before = fixture.snapshot();
    fixture.ok(['move', '-o', 'main']);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['create', 'empty']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.ok(['move', '--onto', 'other', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('empty');
    expect(fixture.git(['rev-parse', 'empty'])).to.equal(other);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('moves a leaf to trunk through the short target spelling', () => {
    fixture.git(['switch', 'tip']);
    fixture.ok(['move', '-o', 'main', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['log', '--format=%s', 'main..tip'])).to.equal('tip');
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'main.txt\ntip.txt'
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  for (const args of [
    ['move', '--onto', 'missing', '--source', 'base'],
    ['move', '-o', 'other', '-s', 'missing'],
    ['move', '-o', 'tip', '-s', 'base'],
    ['move', '-o', 'base', '-s', 'base'],
  ]) {
    it(`keeps original checkout and parents for an invalid selected branch ${args.join(
      ' '
    )}`, () => {
      fixture.git(['switch', 'main']);
      const before = fixture.snapshot();
      expect(fixture.run(args).status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('preserves partially staged departure work before new source/target options can change checkout', () => {
    fixture.git(['switch', 'tip']);
    fixture.stage('main.txt', 'prepared departure work');
    fixture.write('main.txt', 'unfinished departure work');
    const before = fixture.snapshot();
    expect(
      fixture.run(['move', '-o', 'other', '-s', 'base']).status
    ).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });

  it('rejects detached departure with valid explicit short options', () => {
    fixture.git(['switch', '--detach']);
    const before = fixture.snapshot();
    expect(
      fixture.run(['move', '-o', 'other', '-s', 'tip', '--only']).status
    ).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('preserves ignored and untracked bytes through an explicit-source leaf-only success', () => {
    fixture.git(['switch', 'main']);
    fixture.write('private.txt', 'untracked bytes');
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nignored.bin\n');
    const bytes = Buffer.from([0, 255, 13, 10, 23]);
    fs.writeFileSync(path.join(fixture.repo, 'ignored.bin'), bytes);
    fixture.ok(['move', '--onto', 'other', '--source', 'tip', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    expect(
      fs.readFileSync(path.join(fixture.repo, 'ignored.bin'))
    ).to.deep.equal(bytes);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'private.txt'), 'utf8')
    ).to.equal('untracked bytes');
    expect(fixture.git(['log', '--format=%s', 'other..tip'])).to.equal('tip');
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
});
