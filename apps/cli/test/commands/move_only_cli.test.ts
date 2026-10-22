import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move only child detachment through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('detaches the original child subtree before moving only its source', () => {
    const main = fixture.git(['rev-parse', 'main']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.ok(['move', '-o', 'other', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    expect(fixture.git(['ls-tree', '--name-only', 'child'])).to.equal(
      'child.txt\nmain.txt'
    );
    expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'main'],
      ['tip', 'child'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });
  it('stops at a real child conflict and a fresh continue finishes every original subtree and source', () => {
    fixture.stage('main.txt', 'source edit');
    fixture.git(['commit', '-m', 'source edit']);
    fixture.ok(['restack', '--upstack']);
    fixture.env.GIT_COMMITTER_DATE = '2030-01-01T00:00:00Z';
    fixture.env.GIT_AUTHOR_DATE = '2030-01-01T00:00:00Z';
    fixture.branch('sibling', 'base');
    fixture.branch('sibling-tip', 'sibling');
    fixture.env.GIT_COMMITTER_DATE = '2030-01-02T00:00:00Z';
    fixture.env.GIT_AUTHOR_DATE = '2030-01-02T00:00:00Z';
    fixture.git(['switch', 'child']);
    fixture.stage('main.txt', 'child edit');
    fixture.git(['commit', '-m', 'child edit']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    const source = fixture.git(['rev-parse', 'base']);
    const sibling = fixture.git(['rev-parse', 'sibling']);
    const result = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('child')
      .and.include('left-behind child phase');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(true);
    expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
      'main.txt'
    );
    expect(fixture.git(['rev-parse', 'base'])).to.equal(source);
    const completedSibling = fixture.git(['rev-parse', 'sibling']);
    fixture.git(['branch', 'recovery-backup', 'base']);
    fixture.ok(['log', 'short']);
    fixture.stage('main.txt', 'resolved child');
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    if (completedSibling !== sibling)
      expect(fixture.git(['rev-parse', 'sibling'])).to.equal(completedSibling);
    expect(fixture.git(['rev-parse', 'recovery-backup'])).to.equal(source);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..sibling-tip'])
    ).to.equal('sibling\nsibling-tip');
    expect(fixture.git(['ls-tree', '--name-only', 'sibling'])).to.equal(
      'main.txt\nsibling.txt'
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\nchild edit\ntip');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('resolved child');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expect(fixture.git(['show', 'base:main.txt'])).to.equal('source edit');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(false);
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'main'],
      ['tip', 'child'],
      ['sibling', 'main'],
      ['sibling-tip', 'sibling'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });
  it('stops in the source phase after children complete and continues back to a rewritten departure', () => {
    fixture.stage('main.txt', 'source edit');
    fixture.git(['commit', '-m', 'source edit']);
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target edit');
    fixture.git(['commit', '-m', 'target edit']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.git(['switch', 'tip']);
    const result = fixture.run(['move', '-o', 'other', '-s', 'base', '--only']);
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr)
      .to.include('base')
      .and.include('source phase');
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
        )
      )
    ).to.equal(true);
    expect(fixture.git(['diff', '--name-only', '--diff-filter=U'])).to.equal(
      'main.txt'
    );
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    const child = fixture.git(['rev-parse', 'child']);
    const tip = fixture.git(['rev-parse', 'tip']);
    fixture.ok(['info']);
    fixture.ok(['log', 'short']);
    fixture.stage('main.txt', 'resolved source');
    fixture.ok(['continue']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource edit');
    expect(fixture.git(['show', 'base:main.txt'])).to.equal('resolved source');
    expect(fixture.git(['ls-tree', '--name-only', 'child'])).to.equal(
      'child.txt\nmain.txt'
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
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'main'],
      ['tip', 'child'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });
  it('keeps every fan-out subtree and the order of multiple own commits', () => {
    fixture.branch('sibling', 'base');
    fixture.commit('sibling-second');
    fixture.branch('sibling-tip', 'sibling');
    fixture.git(['switch', 'child']);
    fixture.commit('child-second');
    fixture.ok(['restack', '--upstack']);
    fixture.git(['switch', 'base']);
    fixture.commit('base-second');
    fixture.ok(['restack', '--upstack']);
    const names = fixture.git([
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    ]);
    const main = fixture.git(['rev-parse', 'main']);
    const other = fixture.git(['rev-parse', 'other']);
    fixture.ok(['move', 'other', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(
      fixture.git(['for-each-ref', '--format=%(refname)', 'refs/heads'])
    ).to.equal(names);
    expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    for (const [branch, parent, own] of [
      ['base', 'other', 'base\nbase-second'],
      ['child', 'main', 'child\nchild-second'],
      ['tip', 'child', 'tip'],
      ['sibling', 'main', 'sibling\nsibling-second'],
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
    expect(fixture.git(['ls-tree', '--name-only', 'tip'])).to.equal(
      'child-second.txt\nchild.txt\nmain.txt\ntip.txt'
    );
    expect(fixture.git(['show', 'sibling-tip:sibling-second.txt'])).to.equal(
      'sibling-second'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
  });

  it('only to the existing parent detaches children without rewriting the source', () => {
    const base = fixture.git(['rev-parse', 'base']);
    fixture.ok(['move', 'main', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..tip'])
    ).to.equal('child\ntip');
    for (const [branch, parent] of [
      ['base', 'main'],
      ['child', 'main'],
      ['tip', 'child'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });

  it('moves a middle source to an ancestor while its child stays on the old parent', () => {
    const base = fixture.git(['rev-parse', 'base']);
    fixture.git(['switch', 'other']);
    fixture.ok(['move', 'main', '--source', 'child', '--only']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..child'])
    ).to.equal('child');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'base..tip'])
    ).to.equal('tip');
    expect(fixture.git(['show', 'tip:base.txt'])).to.equal('base');
    for (const [branch, parent] of [
      ['child', 'main'],
      ['tip', 'base'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });

  it('detaches an empty child and preserves its deeper own work without helper commits', () => {
    fixture.ok(['create', 'empty-child']);
    fixture.branch('empty-deep', 'empty-child');
    fixture.git(['switch', 'base']);
    fixture.ok(['move', 'other', '--only']);
    expect(fixture.git(['rev-parse', 'empty-child'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.git(['log', '--format=%s', 'main..empty-deep'])).to.equal(
      'empty-deep'
    );
    expect(fixture.git(['ls-tree', '--name-only', 'empty-deep'])).to.equal(
      'empty-deep.txt\nmain.txt'
    );
    for (const [branch, parent] of [
      ['empty-child', 'main'],
      ['empty-deep', 'empty-child'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });

  it('moves an empty source and retains unchanged descendant refs without synthetic commits', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.branch('retained', 'empty-source');
    fixture.branch('deep', 'retained');
    const retained = fixture.git(['rev-parse', 'retained']);
    const deep = fixture.git(['rev-parse', 'deep']);
    fixture.git(['switch', 'empty-source']);
    fixture.ok(['move', 'other', '--only']);
    expect(fixture.git(['rev-parse', 'empty-source'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect(fixture.git(['rev-parse', 'retained'])).to.equal(retained);
    expect(fixture.git(['rev-parse', 'deep'])).to.equal(deep);
    fixture.ok(['checkout', 'retained']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    fixture.ok(['checkout', 'deep']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('retained');
  });

  for (const target of ['base', 'child', 'tip']) {
    it(`rejects only target ${target} before detaching any child in this stage`, () => {
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      const result = fixture.run(['move', target, '-s', 'base', '--only']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['checkout', 'child']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    });
  }
});
