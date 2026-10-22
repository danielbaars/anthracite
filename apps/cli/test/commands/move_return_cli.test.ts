import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

function expectNoRebase(fixture: CreateCliFixture): void {
  for (const state of ['rebase-merge', 'rebase-apply']) {
    expect(
      fs.existsSync(
        path.resolve(
          fixture.repo,
          fixture.git(['rev-parse', '--git-path', state])
        )
      )
    ).to.equal(false);
  }
  expect(fixture.git(['ls-files', '--unmerged'])).to.equal('');
}

function expectActiveRebase(fixture: CreateCliFixture): void {
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
}

// eslint-disable-next-line max-lines-per-function
describe('move departure recovery through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('continues an ordinary explicit-source conflict and returns to the original checkout', () => {
    fixture.stage('main.txt', 'source own change');
    fixture.git(['commit', '-m', 'source own change']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target own change');
    fixture.git(['commit', '-m', 'target own change']);
    const other = fixture.git(['rev-parse', 'other']);
    const result = fixture.run(['move', '--onto', 'other', '--source', 'base']);
    expect(result.status).not.to.equal(0);
    expectActiveRebase(fixture);
    expect(fixture.ok(['log', 'short'])).to.include('base');
    fixture.stage('main.txt', 'explicit resolution');
    fixture.ok(['continue']);
    expectNoRebase(fixture);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..base'])
    ).to.equal('base\nsource own change');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'base..tip'])
    ).to.equal('child\ntip');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
      'explicit resolution'
    );
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    for (const [branch, parent] of [
      ['base', 'other'],
      ['child', 'base'],
      ['tip', 'child'],
    ]) {
      fixture.ok(['checkout', branch]);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
    }
  });
  it('continues a leaf-only conflict back to an untracked departure without tracking it', () => {
    fixture.git(['branch', 'departure', 'other']);
    const departure = fixture.git(['rev-parse', 'departure']);
    const base = fixture.git(['rev-parse', 'base']);
    const child = fixture.git(['rev-parse', 'child']);
    fixture.git(['switch', 'tip']);
    fixture.stage('main.txt', 'leaf own change');
    fixture.git(['commit', '-m', 'leaf own change']);
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'target own change');
    fixture.git(['commit', '-m', 'target own change']);
    fixture.git(['switch', 'departure']);
    const result = fixture.run(['move', '-o', 'other', '-s', 'tip', '--only']);
    expect(result.status).not.to.equal(0);
    expectActiveRebase(fixture);
    fixture.stage('main.txt', 'resolved leaf');
    fixture.ok(['continue']);
    expectNoRebase(fixture);
    expect(fixture.git(['branch', '--show-current'])).to.equal('departure');
    expect(fixture.git(['rev-parse', 'departure'])).to.equal(departure);
    expect(fixture.git(['rev-parse', 'base'])).to.equal(base);
    expect(fixture.git(['rev-parse', 'child'])).to.equal(child);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
    ).to.equal('tip\nleaf own change');
    expect(fixture.git(['show', 'tip:main.txt'])).to.equal('resolved leaf');
    expect(fixture.git(['status', '--porcelain'])).to.equal('');
    const untracked = fixture.run(['down']);
    expect(untracked.status).not.to.equal(0);
    expect(untracked.stdout + untracked.stderr).to.match(
      /untracked branch departure/i
    );
    fixture.ok(['checkout', 'tip']);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('other');
  });

  for (const departure of ['base', 'tip']) {
    it(`continues an ordinary move back to rewritten departure ${departure}`, () => {
      fixture.stage('main.txt', 'source own change');
      fixture.git(['commit', '-m', 'source own change']);
      fixture.git(['switch', 'other']);
      fixture.stage('main.txt', 'target own change');
      fixture.git(['commit', '-m', 'target own change']);
      fixture.git(['switch', departure]);
      const oldDeparture = fixture.git(['rev-parse', departure]);
      expect(
        fixture.run([
          'move',
          '-o',
          'other',
          ...(departure === 'tip' ? ['-s', 'base'] : []),
        ]).status
      ).not.to.equal(0);
      expectActiveRebase(fixture);
      fixture.ok(['info']);
      fixture.stage('main.txt', 'resolved source work');
      fixture.ok(['continue']);
      expectNoRebase(fixture);
      expect(fixture.git(['branch', '--show-current'])).to.equal(departure);
      expect(fixture.git(['rev-parse', departure])).not.to.equal(oldDeparture);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'other..tip'])
      ).to.equal('base\nsource own change\nchild\ntip');
      expect(fixture.git(['show', 'tip:main.txt'])).to.equal(
        'resolved source work'
      );
      expect(fixture.git(['show', 'tip:tip.txt'])).to.equal('tip');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      fixture.ok(['checkout', 'base']);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('other');
    });
  }
});
