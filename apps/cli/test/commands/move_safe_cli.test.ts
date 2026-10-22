import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move safety through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('keeps the departure checkout and public source parent on an unknown target', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'missing', '--source', 'base']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['checkout', 'base']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });
  it('refuses an occupied child before changing the public source parent or either worktree', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'child']);
    fixture.stage('child.txt', 'staged child work', fixture.linked);
    fixture.write('child.txt', 'unstaged child work', fixture.linked);
    const before = fixture.snapshot();
    const otherBefore = fixture.snapshot(fixture.linked);
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(otherBefore);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('protects ignored bytes in the target tree before changing the public parent', () => {
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nother.txt\n');
    const bytes = Buffer.from([0, 255, 13, 10, 42]);
    fs.writeFileSync(path.join(fixture.repo, 'other.txt'), bytes);
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.readFileSync(path.join(fixture.repo, 'other.txt'))).to.deep.equal(
      bytes
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('rejects an unfinished merge with a clean index before changing public parents', () => {
    fixture.git(['merge', '--no-commit', '--no-ff', 'other']);
    fixture.git(['restore', '--staged', '--worktree', '.']);
    const before = fixture.snapshot();
    const mergeHead = fixture.git(['rev-parse', 'MERGE_HEAD']);
    const result = fixture.run(['move', 'other']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.git(['rev-parse', 'MERGE_HEAD'])).to.equal(mergeHead);
    fixture.git(['merge', '--abort']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('rejects detached departure even with a valid explicit source', () => {
    fixture.git(['switch', '--detach']);
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other', '--source', 'base']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
  });

  it('moves ordinary fan-out own commits and reads every parent through fresh navigation', () => {
    fixture.git(['switch', 'base']);
    fixture.branch('sibling', 'base');
    fixture.branch('sibling-tip', 'sibling');
    fixture.git(['switch', 'base']);
    fixture.commit('base-second');
    const other = fixture.git(['rev-parse', 'other']);
    const main = fixture.git(['rev-parse', 'main']);
    fixture.ok(['move', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nbase-second');
    for (const [branch, parent, own] of [
      ['base', 'other', 'base\nbase-second'],
      ['child', 'base', 'child'],
      ['tip', 'child', 'tip'],
      ['sibling', 'base', 'sibling'],
      ['sibling-tip', 'sibling', 'sibling-tip'],
    ]) {
      expect(fixture.git(['merge-base', branch, parent])).to.equal(
        fixture.git(['rev-parse', parent])
      );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${parent}..${branch}`])
      ).to.equal(own);
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
    expect(fixture.git(['show', 'tip:base-second.txt'])).to.equal(
      'base-second'
    );
    expect(fixture.git(['show', 'sibling-tip:sibling.txt'])).to.equal(
      'sibling'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('moves a leaf to trunk through long source and returns to its departure checkout', () => {
    const base = fixture.git(['rev-parse', 'base']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.git(['switch', 'other']);
    fixture.ok(['move', 'main', '--source', 'tip']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['log', '--format=%s', 'main..tip'])).to.equal('tip');
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'main.txt\ntip.txt'
    );
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('leaves an aligned same-parent move and its occupied deep branch unchanged', () => {
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage('tip.txt', 'preserved deep index', fixture.linked);
    fixture.write('tip.txt', 'preserved deep work', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    fixture.ok(['move', 'main']);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('moves an empty leaf without creating a synthetic commit', () => {
    fixture.ok(['create', 'empty']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.ok(['move', 'other']);
    expect(fixture.git(['rev-parse', 'empty'])).to.equal(other);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  for (const target of [
    'missing',
    'untracked',
    'tag-only',
    'origin/main',
    'sha',
    'base',
    'child',
    'tip',
  ]) {
    it(`rejects invalid target ${target} before source checkout and preserves public parents`, () => {
      fixture.git(['branch', 'untracked', 'other']);
      fixture.git(['tag', 'tag-only', 'other']);
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      const result = fixture.run([
        'move',
        target === 'sha' ? fixture.git(['rev-parse', 'base']) : target,
        '--source',
        'base',
      ]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }

  for (const source of [
    'missing',
    'untracked',
    'main',
    'tag-only',
    'origin/main',
    'sha',
  ]) {
    it(`rejects invalid source ${source} before checkout`, () => {
      fixture.git(['branch', 'untracked', 'base']);
      fixture.git(['tag', 'tag-only', 'base']);
      const before = fixture.snapshot();
      const result = fixture.run([
        'move',
        'other',
        '--source',
        source === 'sha' ? before.head : source,
      ]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  for (const kind of ['staged', 'unstaged', 'partial']) {
    for (const target of ['other', 'main']) {
      it(`preserves ${kind} tracked work before long-source checkout towards ${target}`, () => {
        fixture.git(['switch', 'child']);
        if (kind !== 'unstaged') fixture.stage('main.txt', 'prepared content');
        if (kind !== 'staged') fixture.write('main.txt', 'unfinished content');
        const before = fixture.snapshot();
        const result = fixture.run(['move', target, '--source', 'base']);
        expect(result.status).not.to.equal(0);
        expect(fixture.snapshot()).to.deep.equal(before);
        expect(fixture.git(['stash', 'list'])).to.equal('');
      });
    }
  }

  it('preserves unrelated ignored and untracked bytes during a successful whole move', () => {
    const exclude = fixture.git(['rev-parse', '--git-path', 'info/exclude']);
    fs.appendFileSync(path.resolve(fixture.repo, exclude), '\nprivate.bin\n');
    const bytes = Buffer.from([0, 255, 10, 10, 1]);
    fs.writeFileSync(path.join(fixture.repo, 'private.bin'), bytes);
    fixture.write('loose.txt', 'unfinished local work');
    fixture.ok(['move', 'other']);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'private.bin'))
    ).to.deep.equal(bytes);
    expect(
      fs.readFileSync(path.join(fixture.repo, 'loose.txt'), 'utf8')
    ).to.equal('unfinished local work');
    expect(fixture.git(['status', '--porcelain'])).to.equal('?? loose.txt');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('uses the local target tip when a tag has the same name', () => {
    fixture.git(['tag', 'other', 'main']);
    const target = fixture.git(['rev-parse', 'refs/heads/other']);
    fixture.ok(['move', 'other']);
    expect(fixture.git(['rev-parse', 'refs/heads/base^'])).to.equal(target);
    expect(fixture.git(['show', 'base:other.txt'])).to.equal('other');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  it('moves the local source branch when a tag has the same source name', () => {
    fixture.git(['tag', 'base', 'main']);
    const tag = fixture.git(['rev-parse', 'refs/tags/base']);
    fixture.ok(['move', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'refs/heads/base^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect(fixture.git(['rev-parse', 'refs/tags/base'])).to.equal(tag);
    expect(fixture.git(['show', 'refs/heads/base:base.txt'])).to.equal('base');
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
  it('moves a nonempty leaf above another local tracked feature tip', () => {
    fixture.git(['switch', 'tip']);
    fixture.commit('tip-second');
    const parent = fixture.git(['rev-parse', 'other']);
    const child = fixture.git(['rev-parse', 'child']);
    fixture.ok(['move', 'other']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'tip~2'])).to.equal(parent);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('tip\ntip-second');
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'main.txt\nother.txt\ntip-second.txt\ntip.txt'
    );
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });
});
