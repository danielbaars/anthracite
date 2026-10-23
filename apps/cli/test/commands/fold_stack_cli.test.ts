import { expect } from 'chai';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('linear stack folding through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const departure of ['base', 'child', 'tip']) {
    it(`folds the complete chain from ${departure} without rewriting its commits`, () => {
      fixture.git(['switch', 'tip']);
      fixture.commit('tip-second');
      const tip = fixture.git(['rev-parse', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const history = fixture.git(['rev-list', 'tip']);
      const main = fixture.git(['rev-parse', 'main']);
      const other = fixture.git(['rev-parse', 'other']);
      fixture.git(['switch', departure]);
      fixture.ok(['fold', '--stack']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('base');
      expect(fixture.git(['rev-parse', 'base'])).to.equal(tip);
      expect(fixture.git(['rev-parse', 'base^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-list', 'base'])).to.equal(history);
      expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
        'base\nmain\nother'
      );
      expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }
  it('retains multiple own commits at every selected level and ignores colliding tags', () => {
    fixture.git(['switch', 'base']);
    fixture.commit('base-second');
    fixture.ok(['restack', '--branch', 'base']);
    fixture.git(['switch', 'child']);
    fixture.commit('child-second');
    fixture.ok(['restack', '--branch', 'child']);
    fixture.git(['switch', 'tip']);
    fixture.commit('tip-second');
    fixture.git(['tag', 'base', 'main']);
    fixture.git(['tag', 'tip', 'main']);
    const tip = fixture.git(['rev-parse', 'refs/heads/tip']);
    const history = fixture.git(['rev-list', 'refs/heads/tip']);
    fixture.git(['switch', 'child']);
    fixture.ok(['fold', '--stack']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(fixture.git(['rev-parse', 'refs/heads/base'])).to.equal(tip);
    expect(fixture.git(['rev-list', 'refs/heads/base'])).to.equal(history);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..refs/heads/base'])
    ).to.equal('base\nbase-second\nchild\nchild-second\ntip\ntip-second');
    expect(fixture.git(['rev-parse', 'refs/tags/base'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
  });
});

// eslint-disable-next-line max-lines-per-function
describe('stack fold bounded inputs through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('accepts explicit false keep and identical repeated stack booleans', () => {
    fixture.ok([
      'fold',
      '--stack=true',
      '--stack',
      '--keep=false',
      '--keep=false',
    ]);
    expect(fixture.git(['branch', '--show-current'])).to.equal('base');
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..base'])
    ).to.equal('base\nchild\ntip');
  });

  for (const workAt of ['none', 'empty-base', 'empty-middle', 'empty-tip']) {
    it(`retains empty chain members correctly with work at ${workAt}`, () => {
      fixture.git(['switch', 'main']);
      for (const name of ['empty-base', 'empty-middle', 'empty-tip']) {
        fixture.ok(['create', name]);
        if (workAt === name) fixture.commit('own-work');
      }
      const tip = fixture.git(['rev-parse', 'empty-tip']);
      const tree = fixture.git(['rev-parse', 'empty-tip^{tree}']);
      fixture.git(['switch', 'empty-middle']);
      fixture.ok(['fold', '--stack']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('empty-base');
      expect(fixture.git(['rev-parse', 'empty-base'])).to.equal(tip);
      expect(fixture.git(['rev-parse', 'empty-base^{tree}'])).to.equal(tree);
      expect(fixture.git(['branch', '--list', 'empty-*'])).to.equal(
        '* empty-base'
      );
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('treats a valid isolated feature as a no-op', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    fixture.ok(['fold', '--stack']);
    expect(fixture.snapshot()).to.deep.equal(before);
    fixture.ok(['down']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('main');
  });

  for (const args of [
    ['--stack='],
    ['--stack', ''],
    ['--stack=false', '--stack'],
    ['--stack=garbage'],
    ['--stack', '--stack=false'],
    ['--stack', '--keep='],
    ['--stack', '--keep=garbage'],
    ['--stack', '--keep', '--keep=false'],
    ['--stack', '-k', '--keep=false'],
    ['--stack', '--close'],
    ['--stack', '--force'],
    ['--stack', 'tip'],
    ['--stack', '--keep'],
    ['--stack', '-k'],
  ]) {
    it(`refuses unsupported input ${JSON.stringify(
      args
    )} without effects`, () => {
      const before = fixture.snapshot();
      const result = fixture.run(['fold', ...args]);
      expect(result.status).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      fixture.ok(['down']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
    });
  }

  it('explains whole-chain scope and the current bottom survivor in help', () => {
    const result = fixture.ok(['fold', '--help']);
    expect(result).to.include('--stack');
    expect(result).to.include('trunk-to-tip');
    expect(result).to.include('bottom');
  });
});
