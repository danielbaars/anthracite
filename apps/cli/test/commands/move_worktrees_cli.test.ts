import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('move worktree preflight through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const branch of ['base', 'child', 'tip']) {
    it(`protects both indexes, work and public parents when ${branch} is occupied`, () => {
      if (branch === 'base') fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, branch]);
      fixture.stage('main.txt', 'linked prepared work', fixture.linked);
      fixture.write('main.txt', 'linked unfinished work', fixture.linked);
      fixture.write('private.txt', 'linked untracked work', fixture.linked);
      const before = fixture.snapshot();
      const linkedBefore = fixture.snapshot(fixture.linked);
      const result = fixture.run(['move', 'other', '--source', 'base']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
      fixture.ok(
        ['checkout', 'base'],
        branch === 'base' ? fixture.linked : fixture.repo
      );
      fixture.ok(['down'], branch === 'base' ? fixture.linked : fixture.repo);
      expect(
        fixture.git(
          ['branch', '--show-current'],
          branch === 'base' ? fixture.linked : fixture.repo
        )
      ).to.equal('main');
    });
  }

  for (const branch of ['main', 'other']) {
    it(`allows read-only ${branch} in another worktree and preserves its index and bytes`, () => {
      fixture.git(['worktree', 'add', fixture.linked, branch]);
      fixture.stage('main.txt', 'linked staged work', fixture.linked);
      fixture.write('main.txt', 'linked unstaged work', fixture.linked);
      fixture.write('private.txt', 'linked untracked work', fixture.linked);
      const linkedBefore = fixture.snapshot(fixture.linked);
      fixture.ok(['move', 'other']);
      const linkedAfter = fixture.snapshot(fixture.linked);
      expect({ ...linkedAfter, refs: linkedBefore.refs }).to.deep.equal(
        linkedBefore
      );
      expect(fixture.git(['rev-parse', 'base^'])).to.equal(
        fixture.git(['rev-parse', 'other'])
      );
      if (branch === 'other')
        fixture.git(['switch', '--detach'], fixture.linked);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    });
  }

  it('moves from its own linked worktree without changing main work or index', () => {
    fixture.git(['switch', 'main']);
    fixture.git(['worktree', 'add', fixture.linked, 'base']);
    fixture.stage('main.txt', 'main staged work');
    fixture.write('main.txt', 'main unstaged work');
    fixture.write('private.txt', 'main untracked work');
    const before = fixture.snapshot();
    fixture.ok(['move', 'other'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'base'
    );
    expect(fixture.git(['rev-parse', 'base^'])).to.equal(
      fixture.git(['rev-parse', 'other'])
    );
    expect({ ...fixture.snapshot(), refs: before.refs }).to.deep.equal(before);
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'other'
    );
  });

  it('allows an unchanged occupied deep branch when only source parent metadata changes', () => {
    fixture.git(['branch', 'same-tip', 'main']);
    fixture.ok(['track', 'same-tip', '--parent', 'main']);
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage('main.txt', 'linked staged work', fixture.linked);
    fixture.write('main.txt', 'linked unstaged work', fixture.linked);
    const before = fixture.refs();
    const linkedBefore = fixture.snapshot(fixture.linked);
    fixture.ok(['move', 'same-tip']);
    expect(fixture.refs()).to.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('same-tip');
  });

  it('detects an occupied already-needs-restack deep branch during a same-parent move', () => {
    fixture.commit('base-more');
    fixture.git(['worktree', 'add', fixture.linked, 'tip']);
    fixture.stage('main.txt', 'linked staged work', fixture.linked);
    fixture.write('main.txt', 'linked unstaged work', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const result = fixture.run(['move', 'main']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  it('restacks an already-needs-restack subtree on an otherwise same-parent move', () => {
    fixture.commit('base-more');
    const base = fixture.git(['rev-parse', 'base']);
    fixture.ok(['move', 'main']);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child^'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'tip^'])).to.equal(
      fixture.git(['rev-parse', 'child'])
    );
    expect(fixture.git(['show', 'tip:base-more.txt'])).to.equal('base-more');
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('child');
  });

  it('rejects a source whose original parent chain is no longer tracked', () => {
    fixture.ok(['untrack', 'base', '--force']);
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other', '--source', 'child']);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['checkout', 'child']);
    expect(fixture.run(['down']).status).not.to.equal(0);
  });

  for (const operation of [
    'cherry-pick',
    'revert',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
  ]) {
    it(`preserves a real staged ${operation} conflict`, () => {
      fixture.stage('main.txt', 'source conflict');
      fixture.git(['commit', '-m', 'source conflicting edit']);
      const source = fixture.git(['rev-parse', 'HEAD']);
      fixture.stage('main.txt', 'later source edit');
      fixture.git(['commit', '-m', 'later conflicting edit']);
      fixture.git(['switch', 'other']);
      fixture.stage('main.txt', 'target conflict');
      fixture.git(['commit', '-m', 'target conflicting edit']);
      fixture.git(['switch', 'base']);
      const command =
        operation === 'revert'
          ? ['revert', '--no-edit', source]
          : operation === 'cherry-pick'
          ? ['cherry-pick', 'other']
          : operation === 'sequencer'
          ? ['cherry-pick', 'other', 'child']
          : [
              'rebase',
              operation === 'rebase-merge' ? '--merge' : '--apply',
              'other',
            ];
      expect(() => fixture.git(command)).to.throw();
      fixture.stage('main.txt', 'explicit staged resolution');
      const before = fixture.snapshot();
      const state = fixture.git([
        'rev-parse',
        '--git-path',
        operation.startsWith('rebase')
          ? operation
          : operation === 'sequencer'
          ? 'sequencer'
          : operation === 'revert'
          ? 'REVERT_HEAD'
          : 'CHERRY_PICK_HEAD',
      ]);
      expect(fs.existsSync(path.resolve(fixture.repo, state))).to.equal(true);
      const result = fixture.run(['move', 'other', '--source', 'base']);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.existsSync(path.resolve(fixture.repo, state))).to.equal(true);
      fixture.git([
        operation.startsWith('rebase')
          ? 'rebase'
          : operation === 'revert'
          ? 'revert'
          : 'cherry-pick',
        '--abort',
      ]);
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }
  it('rejects an occupied empty source even when only its parent name would change', () => {
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'same-tip']);
    fixture.git(['switch', 'main']);
    fixture.ok(['create', 'empty-source']);
    fixture.git(['switch', 'base']);
    fixture.git(['worktree', 'add', fixture.linked, 'empty-source']);
    fixture.stage('main.txt', 'linked prepared work', fixture.linked);
    fixture.write('main.txt', 'linked unfinished work', fixture.linked);
    const before = fixture.snapshot();
    const linkedBefore = fixture.snapshot(fixture.linked);
    const result = fixture.run([
      'move',
      'same-tip',
      '--source',
      'empty-source',
    ]);
    expect(result.status).not.to.equal(0);
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fixture.snapshot(fixture.linked)).to.deep.equal(linkedBefore);
    fixture.git(['restore', '--staged', '--worktree', '.'], fixture.linked);
    fixture.ok(['down'], fixture.linked);
    expect(fixture.git(['branch', '--show-current'], fixture.linked)).to.equal(
      'main'
    );
  });
});
