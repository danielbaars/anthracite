import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';

for (const keep of [false, true]) {
  const survivor = keep ? 'tip' : 'base';
  const keepArgs = keep ? ['--keep'] : [];
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold safety through the public CLI (keep ${keep})`, function () {
    this.timeout(60000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());

    function refuse(message: string, args: readonly string[] = []): void {
      const before = fixture.snapshot();
      const index = path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'index'])
      );
      const bytes = fs.readFileSync(index);
      const result = fixture.run(['fold', '--stack', ...keepArgs, ...args]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(message);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.readFileSync(index)).to.deep.equal(bytes);
    }

    for (const branch of ['base', 'other']) {
      for (const kind of ['staged', 'unstaged', 'partial']) {
        it(`preserves ${kind} tracked work on ${branch}, including the no-op`, () => {
          fixture.git(['switch', branch]);
          if (kind !== 'unstaged') fixture.stage('main.txt', 'prepared work');
          if (kind !== 'staged') fixture.write('main.txt', 'unfinished work');
          refuse('tracked changes');
          expect(fixture.git(['stash', 'list'])).to.equal('');
        });
      }
    }

    for (const branch of ['base', 'main']) {
      it(`refuses selected needs-restack caused by newer ${branch} work`, () => {
        fixture.git(['switch', branch]);
        fixture.commit('new-parent');
        fixture.git(['switch', 'tip']);
        refuse('needs restack');
        const result = fixture.run(['fold', '--stack', ...keepArgs]);
        expect(result.stdout + result.stderr).to.include('an restack');
        expectParent(fixture, 'child', 'base');
        expectParent(fixture, 'base', 'main');
      });
    }

    it('preserves a fan-out beside the downstack with one tip above departure', () => {
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'child']);
      fixture.ok(['fold', '--stack', ...keepArgs]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expectParent(fixture, 'sibling', survivor);
    });

    it('refuses ambiguous upstack tips under quiet noninteractive operation', () => {
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'base']);
      refuse('unique tip', ['--quiet']);
      expectParent(fixture, 'sibling', 'base');
    });

    it('refuses trunk and detached HEAD', () => {
      fixture.git(['switch', 'main']);
      refuse('trunk');
      fixture.git(['switch', '--detach']);
      refuse('without a branch checked out');
    });

    it('refuses an untracked parent chain', () => {
      fixture.ok(['untrack', 'base', '--force']);
      fixture.git(['switch', 'tip']);
      refuse('track');
    });

    it('refuses a missing parent before checkout', () => {
      fixture.git(['switch', 'tip']);
      fixture.git(['branch', '-D', 'child']);
      refuse('track');
    });

    it('refuses a real unfinished merge even with a clean index', () => {
      fixture.git(['merge', '--no-commit', '--no-ff', 'other']);
      fixture.git(['restore', '--staged', '--worktree', '.']);
      const mergeHead = fixture.git(['rev-parse', 'MERGE_HEAD']);
      refuse('MERGE_HEAD');
      expect(fixture.git(['rev-parse', 'MERGE_HEAD'])).to.equal(mergeHead);
      fixture.git(['merge', '--abort']);
    });

    it('preserves a genuine conflicted Git rebase and its unmerged entries', () => {
      fixture.git(['switch', 'other']);
      fixture.stage('main.txt', 'other conflicting work');
      fixture.git(['commit', '-m', 'other conflicting work']);
      fixture.git(['switch', 'base']);
      fixture.stage('main.txt', 'base conflicting work');
      fixture.git(['commit', '-m', 'base conflicting work']);
      expect(() => fixture.git(['rebase', 'other'])).to.throw();
      const unmerged = fixture.git(['ls-files', '--unmerged', '-z']);
      expect(unmerged).not.to.equal('');
      const state = path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
      );
      expect(fs.existsSync(state)).to.equal(true);
      refuse('rebase-merge');
      expect(fixture.git(['ls-files', '--unmerged', '-z'])).to.equal(unmerged);
      expect(fs.existsSync(state)).to.equal(true);
      fixture.git(['rebase', '--abort']);
    });

    for (const occupied of ['base', 'child', 'tip']) {
      it(`protects the occupied selected name ${occupied} and both indexes`, () => {
        fixture.git(['switch', occupied === 'base' ? 'tip' : 'base']);
        fixture.git(['worktree', 'add', fixture.linked, occupied]);
        fixture.stage('main.txt', 'linked staged', fixture.linked);
        fixture.write('main.txt', 'linked unstaged', fixture.linked);
        const linked = fixture.snapshot(fixture.linked);
        const index = path.resolve(
          fixture.linked,
          fixture.git(['rev-parse', '--git-path', 'index'], fixture.linked)
        );
        const bytes = fs.readFileSync(index);
        refuse('worktree');
        expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
        expect(fs.readFileSync(index)).to.deep.equal(bytes);
        fixture.git(['switch', '--detach'], fixture.linked);
        expectParent(fixture, 'child', 'base');
        expectParent(fixture, 'tip', 'child');
      });
    }

    it('protects even an empty selected name active elsewhere', () => {
      fixture.git(['switch', 'tip']);
      fixture.ok(['create', 'empty-tip']);
      fixture.git(['switch', 'base']);
      fixture.git(['worktree', 'add', fixture.linked, 'empty-tip']);
      const linked = fixture.snapshot(fixture.linked);
      refuse('worktree');
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(linked);
    });

    it('allows a read-only trunk active elsewhere', () => {
      fixture.git(['worktree', 'add', fixture.linked, 'main']);
      fixture.stage('main.txt', 'trunk staged', fixture.linked);
      fixture.write('main.txt', 'trunk unfinished', fixture.linked);
      const linked = fixture.snapshot(fixture.linked);
      fixture.ok(['fold', '--stack', ...keepArgs]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.snapshot(fixture.linked)).to.deep.equal({
        ...linked,
        refs: fixture.refs(),
      });
    });

    it('executes from the owning linked worktree without altering the main index', () => {
      fixture.git(['switch', 'other']);
      fixture.git(['worktree', 'add', fixture.linked, 'child']);
      fixture.stage('other.txt', 'original staged');
      fixture.write('other.txt', 'original unfinished');
      const original = fixture.snapshot();
      const tip = fixture.git(['rev-parse', 'tip']);
      fixture.ok(['fold', '--stack', ...keepArgs], fixture.linked);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['diff', '--cached', '--binary'])).to.equal(
        original.staged
      );
      expect(fixture.git(['diff', '--binary'])).to.equal(original.unstaged);
      expect(fixture.git(['rev-parse', 'HEAD'])).to.equal(original.head);
      fixture.ok(['down'], fixture.linked);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal('main');
    });

    it('retains every selected ref and public parent when Git refuses the whole transaction', () => {
      const hook = path.join(
        fixture.repo,
        '.git',
        'hooks',
        'reference-transaction'
      );
      fs.writeFileSync(
        hook,
        '#!/bin/sh\nif [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/heads/tip) echo "selected transaction refused" >&2; exit 1;; esac\ndone\nfi\n',
        { mode: 0o755 }
      );
      const before = fixture.snapshot();
      const result = fixture.run(['fold', '--stack', ...keepArgs]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        'Selected refs were not published'
      );
      expect(result.stdout + result.stderr).to.include(
        'selected transaction refused'
      );
      expect(fixture.snapshot()).to.deep.equal(before);
      expectParent(fixture, 'base', 'main');
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });
  });
}
