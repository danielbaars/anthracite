import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';

for (const keep of [false, true]) {
  const survivor = keep ? 'tip' : 'base';
  const args = ['fold', '--stack', `--keep=${keep}`];
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold fan-out safety through the public CLI (keep=${keep})`, function () {
    this.timeout(60000);
    let fixture: CreateCliFixture;
    beforeEach(() => {
      fixture = new CreateCliFixture();
    });
    afterEach(() => fixture?.cleanup());
    function index(cwd: string): Buffer {
      return fs.readFileSync(
        path.resolve(
          cwd,
          fixture.git(['rev-parse', '--git-path', 'index'], cwd)
        )
      );
    }
    function refuse(message: string): void {
      const before = fixture.snapshot();
      const bytes = index(fixture.repo);
      const result = fixture.run(args);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(message);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(index(fixture.repo)).to.deep.equal(bytes);
    }
    for (const occupied of ['sibling', 'deep']) {
      it(`protects an occupied ${occupied} before collapse and preserves both worktrees`, () => {
        fixture.branch('sibling', 'base');
        fixture.branch('deep', 'sibling');
        fixture.git(['switch', 'tip']);
        fixture.git(['worktree', 'add', fixture.linked, occupied]);
        fixture.stage('main.txt', 'linked staged', fixture.linked);
        fixture.write('main.txt', 'linked unfinished', fixture.linked);
        const before = fixture.snapshot(fixture.linked);
        const bytes = index(fixture.linked);
        refuse(occupied);
        expect(fixture.snapshot(fixture.linked)).to.deep.equal(before);
        expect(index(fixture.linked)).to.deep.equal(bytes);
        fixture.git(['switch', '--detach'], fixture.linked);
        expectParent(fixture, 'sibling', 'base');
        expectParent(fixture, 'deep', 'sibling');
      });
    }
    it('protects an empty reparented root even when its SHA stays equal', () => {
      fixture.git(['switch', 'main']);
      fixture.ok(['create', 'empty-base']);
      fixture.ok(['create', 'empty-middle']);
      fixture.ok(['create', 'empty-tip']);
      fixture.git(['switch', 'empty-middle']);
      fixture.ok(['create', 'empty-root']);
      fixture.git(['switch', 'empty-tip']);
      fixture.git(['worktree', 'add', fixture.linked, 'empty-root']);
      const before = fixture.snapshot(fixture.linked);
      const bytes = index(fixture.linked);
      refuse('empty-root');
      expect(fixture.snapshot(fixture.linked)).to.deep.equal(before);
      expect(index(fixture.linked)).to.deep.equal(bytes);
    });
    it('allows a truly unchanged deep worktree when an empty root only changes parent', () => {
      fixture.git(['switch', 'main']);
      fixture.ok(['create', 'empty-base']);
      fixture.ok(['create', 'empty-middle']);
      fixture.ok(['create', 'empty-tip']);
      fixture.git(['switch', 'empty-middle']);
      fixture.ok(['create', 'empty-root']);
      fixture.branch('deep', 'empty-root');
      const old = fixture.git(['rev-parse', 'deep']);
      fixture.git(['switch', 'empty-tip']);
      fixture.git(['worktree', 'add', fixture.linked, 'deep']);
      fixture.stage('main.txt', 'linked staged', fixture.linked);
      fixture.write('main.txt', 'linked unfinished', fixture.linked);
      const before = fixture.snapshot(fixture.linked);
      const bytes = index(fixture.linked);
      fixture.ok(args);
      expect(fixture.git(['branch', '--show-current'])).to.equal(
        keep ? 'empty-tip' : 'empty-base'
      );
      expect(fixture.git(['rev-parse', 'deep'])).to.equal(old);
      const after = fixture.snapshot(fixture.linked);
      expect({ ...after, refs: before.refs }).to.deep.equal(before);
      expect(index(fixture.linked)).to.deep.equal(bytes);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
    });
    for (const amended of [false, true]) {
      it(`allows stale off-chain bases after parent amendment=${amended} and replays only original own work`, () => {
        fixture.branch('sibling', 'base');
        fixture.branch('deep', 'sibling');
        fixture.git(['switch', 'base']);
        if (amended) {
          fixture.stage('new-base.txt', 'new-base');
          fixture.git(['commit', '--amend', '-m', 'amended-base']);
        } else fixture.commit('new-base');
        fixture.ok(['restack', '--branch', 'child', '--upstack']);
        fixture.git(['switch', 'tip']);
        fixture.ok(args);
        expect(
          fixture.git([
            'log',
            '--reverse',
            '--format=%s',
            `${survivor}..sibling`,
          ])
        ).to.equal('sibling');
        expect(
          fixture.git(['log', '--reverse', '--format=%s', 'sibling..deep'])
        ).to.equal('deep');
        expect(fixture.git(['show', 'deep:new-base.txt'])).to.equal('new-base');
        expect(
          fixture.git(['log', '--reverse', '--format=%s', `main..${survivor}`])
        ).to.equal(
          amended ? 'amended-base\nchild\ntip' : 'base\nnew-base\nchild\ntip'
        );
      });
    }
    it('refuses a publicly invalid off-chain replay base before selected names disappear', () => {
      fixture.branch('sibling', 'base');
      fixture.git(['switch', 'tip']);
      fixture.git(['branch', '-f', 'sibling', 'other']);
      refuse('sibling');
    });
    it('keeps roots and selected refs intact when atomic selected publication is rejected', () => {
      fixture.branch('sibling', 'base');
      fixture.branch('deep', 'sibling');
      fixture.git(['switch', 'tip']);
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/reference-transaction'),
        '#!/bin/sh\nif [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/heads/child) echo "selected transaction refused" >&2; exit 1;; esac\ndone\nfi\n',
        { mode: 0o755 }
      );
      refuse('selected transaction refused');
      fs.unlinkSync(
        path.join(fixture.repo, '.git/hooks/reference-transaction')
      );
      expectParent(fixture, 'sibling', 'base');
      expectParent(fixture, 'deep', 'sibling');
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });
    it('executes in its own linked worktree and preserves the original index and bytes', () => {
      fixture.branch('sibling', 'base');
      fixture.branch('deep', 'sibling');
      fixture.git(['switch', 'other']);
      fixture.stage('main.txt', 'main staged');
      fixture.write('main.txt', 'main unfinished');
      fixture.git(['worktree', 'add', fixture.linked, 'tip']);
      const before = fixture.snapshot();
      const bytes = index(fixture.repo);
      fixture.ok(args, fixture.linked);
      expect(
        fixture.git(['branch', '--show-current'], fixture.linked)
      ).to.equal(survivor);
      const after = fixture.snapshot();
      expect({ ...after, refs: before.refs }).to.deep.equal(before);
      expect(index(fixture.repo)).to.deep.equal(bytes);
      expect(fixture.git(['status', '--porcelain'], fixture.linked)).to.equal(
        ''
      );
    });
  });
}
