import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

for (const keep of [false, true]) {
  // eslint-disable-next-line max-lines-per-function
  describe(`stack fold off-chain PR scope through the public CLI (keep=${keep})`, function () {
    this.timeout(90000);
    let fixture: SubmitCliFixture;
    beforeEach(() => {
      fixture = new SubmitCliFixture();
    });
    afterEach(() => fixture?.cleanup());
    function identity(output: string): string {
      return output
        .split('\n')
        .filter(
          (line) => line.startsWith('PR #') || line.startsWith('https://')
        )
        .join('\n');
    }
    function snapshot(): {
      refs: string;
      remote: string;
      index: Buffer;
      head: string;
    } {
      return {
        refs: fixture.git(
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/heads'
        ),
        remote: fixture.git('ls-remote', '--heads', 'origin'),
        index: fs.readFileSync(path.join(fixture.repo, '.git/index')),
        head: fixture.git('rev-parse', 'HEAD'),
      };
    }
    for (const state of ['OPEN', 'CLOSED', 'MERGED']) {
      for (const target of ['side', 'deep']) {
        it(`preserves a known ${state} PR on changed ${target} before collapse`, () => {
          fixture.branch(target, 'main');
          fixture.succeed('submit', '--publish');
          fixture.branch('base', 'main');
          fixture.branch('child', 'base');
          fixture.branch('tip', 'child');
          if (target === 'deep') fixture.branch('side', 'base');
          fixture.succeed(
            'move',
            target === 'deep' ? 'side' : 'base',
            '--source',
            target
          );
          fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state })));
          fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
          fixture.succeed('checkout', target);
          const info = identity(fixture.succeed('info'));
          expect(info).to.include('PR #1');
          fixture.succeed('checkout', 'tip');
          const before = snapshot();
          const prs = fixture.prs();
          fixture.clearCalls();
          const result = fixture.cli('fold', '--stack', `--keep=${keep}`);
          expect(result.status).not.to.equal(0);
          expect(result.stdout + result.stderr).to.include(
            `Cannot fold ${target}`
          );
          expect(snapshot()).to.deep.equal(before);
          expect(fixture.git('branch', '--show-current')).to.equal('tip');
          fixture.succeed('checkout', target);
          expect(identity(fixture.succeed('info'))).to.equal(info);
          expect(fixture.prs()).to.deep.equal(prs);
          expect(fixture.calls()).to.deep.equal([]);
          for (const [name, parent] of [
            ['base', 'main'],
            ['child', 'base'],
            ['tip', 'child'],
            ['side', 'base'],
            ...(target === 'deep' ? [['deep', 'side']] : []),
          ]) {
            fixture.succeed('checkout', name);
            expect(fixture.succeed('info')).to.include(`Parent: ${parent}`);
          }
        });
      }
    }
    it('protects a PR root with only a parent-name change and no SHA change', () => {
      fixture.branch('side', 'main');
      fixture.succeed('submit', '--publish');
      fixture.git('switch', 'main');
      for (const name of ['empty-base', 'empty-middle', 'empty-tip'])
        fixture.succeed('create', name);
      fixture.succeed('move', 'empty-middle', '--source', 'side');
      fixture.succeed('checkout', 'side');
      const info = identity(fixture.succeed('info'));
      fixture.git('switch', 'empty-tip');
      const before = snapshot();
      const prs = fixture.prs();
      fixture.clearCalls();
      const result = fixture.cli('fold', '--stack', `--keep=${keep}`);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('Cannot fold side');
      expect(snapshot()).to.deep.equal(before);
      fixture.succeed('checkout', 'side');
      expect(identity(fixture.succeed('info'))).to.equal(info);
      expect(fixture.prs()).to.deep.equal(prs);
      expect(fixture.calls()).to.deep.equal([]);
    });
    it('allows a known PR on a truly unchanged deep branch under a parent-only root', () => {
      fixture.branch('deep', 'main');
      fixture.succeed('submit', '--publish');
      fixture.git('switch', 'main');
      for (const name of ['empty-base', 'empty-middle', 'empty-tip'])
        fixture.succeed('create', name);
      fixture.git('switch', 'empty-middle');
      fixture.succeed('create', 'empty-root');
      fixture.succeed('move', 'empty-root', '--source', 'deep');
      const deep = fixture.git('rev-parse', 'deep');
      fixture.succeed('checkout', 'deep');
      const info = identity(fixture.succeed('info'));
      fixture.git('switch', 'empty-tip');
      const remote = fixture.git('ls-remote', '--heads', 'origin');
      const prs = fixture.prs();
      fixture.clearCalls();
      fixture.succeed('fold', '--stack', `--keep=${keep}`);
      expect(fixture.git('branch', '--show-current')).to.equal(
        keep ? 'empty-tip' : 'empty-base'
      );
      expect(fixture.git('rev-parse', 'deep')).to.equal(deep);
      fixture.succeed('checkout', 'deep');
      expect(identity(fixture.succeed('info'))).to.equal(info);
      expect(fixture.calls()).to.deep.equal([]);
      expect(fixture.prs()).to.deep.equal(prs);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
    });
    if (!keep)
      it('allows a PR root whose parent and tip both truly stay unchanged', () => {
        fixture.branch('side', 'main');
        fixture.succeed('submit', '--publish');
        fixture.git('switch', 'main');
        fixture.succeed('create', 'empty-base');
        fixture.succeed('create', 'empty-tip');
        fixture.succeed('move', 'empty-base', '--source', 'side');
        fixture.succeed('checkout', 'side');
        const info = identity(fixture.succeed('info'));
        const side = fixture.git('rev-parse', 'side');
        fixture.git('switch', 'empty-tip');
        const prs = fixture.prs();
        const remote = fixture.git('ls-remote', '--heads', 'origin');
        fixture.clearCalls();
        fixture.succeed('fold', '--stack');
        expect(fixture.git('branch', '--show-current')).to.equal('empty-base');
        expect(fixture.git('rev-parse', 'side')).to.equal(side);
        fixture.succeed('checkout', 'side');
        expect(identity(fixture.succeed('info'))).to.equal(info);
        expect(fixture.prs()).to.deep.equal(prs);
        expect(fixture.calls()).to.deep.equal([]);
        expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
      });
  });
}
