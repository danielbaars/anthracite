import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { SubmitCliFixture } from '../lib/fixtures/submit_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack fold local PR policy through the public CLI', function () {
  this.timeout(120000);
  let fixture: SubmitCliFixture;
  beforeEach(() => {
    fixture = new SubmitCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  function identity(output: string): string {
    return output
      .split('\n')
      .filter((line) => line.startsWith('PR #') || line.startsWith('https://'))
      .join('\n');
  }

  function setup(selected: string, state: string): void {
    fixture.branch(selected, 'main');
    fixture.succeed('submit', '--publish');
    if (selected !== 'base') fixture.branch('base', 'main');
    if (selected === 'child')
      fixture.succeed('move', 'base', '--source', 'child');
    else fixture.branch('child', 'base');
    if (selected === 'tip') fixture.succeed('move', 'child', '--source', 'tip');
    else fixture.branch('tip', 'child');
    fixture.setPrs(fixture.prs().map((pr) => ({ ...pr, state })));
    fixture.succeed('sync', '--no-pull', '--no-delete', '--no-restack');
    fixture.git('switch', selected);
  }

  for (const state of ['OPEN', 'CLOSED', 'MERGED']) {
    for (const selected of ['base', 'child', 'tip']) {
      it(`preserves a known ${state} PR on selected ${selected} before effects`, () => {
        setup(selected, state);
        const info = fixture.succeed('info');
        expect(info).to.include('PR #1');
        expect(info).to.include('https://github.com/fixture/submit/pull/1');
        if (state === 'CLOSED') expect(info).to.include('(Abandoned)');
        if (state === 'MERGED') expect(info).to.include('(Merged)');
        const prs = fixture.prs();
        const remote = fixture.git('ls-remote', '--heads', 'origin');
        const refs = fixture.git(
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/heads'
        );
        const index = fs.readFileSync(path.join(fixture.repo, '.git', 'index'));
        fixture.clearCalls();
        const result = fixture.cli('fold', '--stack');
        expect(result.status).not.to.equal(0);
        expect(result.stdout + result.stderr).to.include(
          `Cannot fold ${selected}`
        );
        expect(result.stdout + result.stderr).to.include('locally known PR');
        expect(fixture.git('branch', '--show-current')).to.equal(selected);
        expect(
          fixture.git(
            'for-each-ref',
            '--format=%(refname) %(objectname)',
            'refs/heads'
          )
        ).to.equal(refs);
        expect(
          fs.readFileSync(path.join(fixture.repo, '.git', 'index'))
        ).to.deep.equal(index);
        expect(identity(fixture.succeed('info'))).to.equal(identity(info));
        expect(fixture.calls()).to.deep.equal([]);
        expect(fixture.prs()).to.deep.equal(prs);
        expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
        for (const [branch, parent] of [
          ['base', 'main'],
          ['child', 'base'],
          ['tip', 'child'],
        ]) {
          fixture.succeed('checkout', branch);
          expect(fixture.succeed('info')).to.include(`Parent: ${parent}`);
        }
      });
    }
  }

  it('applies the same PR guard to an isolated feature no-op', () => {
    fixture.branch('alone', 'main');
    fixture.succeed('submit');
    const refs = fixture.git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads'
    );
    fixture.clearCalls();
    const result = fixture.cli('fold', '--stack');
    expect(result.status).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('locally known PR');
    expect(
      fixture.git(
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/heads'
      )
    ).to.equal(refs);
    expect(fixture.calls()).to.deep.equal([]);
    expect(fixture.succeed('info')).to.include('PR #1');
  });

  it('allows an unrelated known PR stack and leaves its remote fields untouched', () => {
    fixture.branch('other', 'main');
    fixture.succeed('submit');
    const info = fixture.succeed('info');
    fixture.branch('base', 'main');
    fixture.branch('child', 'base');
    fixture.branch('tip', 'child');
    const tip = fixture.git('rev-parse', 'tip');
    const remote = fixture.git('ls-remote', '--heads', 'origin');
    const prs = fixture.prs();
    fixture.clearCalls();
    fixture.succeed('fold', '--stack');
    expect(fixture.git('branch', '--show-current')).to.equal('base');
    expect(fixture.git('rev-parse', 'base')).to.equal(tip);
    expect(fixture.calls()).to.deep.equal([]);
    expect(fixture.prs()).to.deep.equal(prs);
    expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
    fixture.succeed('checkout', 'other');
    expect(identity(fixture.succeed('info'))).to.equal(identity(info));
  });
  for (const keep of [false, true]) {
    it(`ordinary baseline preserves the survivor PR identity with keep ${keep}`, () => {
      setup(keep ? 'child' : 'base', 'OPEN');
      const identityBefore = identity(fixture.succeed('info'));
      fixture.git('switch', 'child');
      const remote = fixture.git('ls-remote', '--heads', 'origin');
      const prs = fixture.prs();
      fixture.clearCalls();
      fixture.succeed('fold', ...(keep ? ['--keep'] : []));
      expect(fixture.git('branch', '--show-current')).to.equal(
        keep ? 'child' : 'base'
      );
      expect(identity(fixture.succeed('info'))).to.equal(identityBefore);
      expect(fixture.calls()).to.deep.equal([]);
      expect(fixture.prs()).to.deep.equal(prs);
      expect(fixture.git('ls-remote', '--heads', 'origin')).to.equal(remote);
    });
  }
});
