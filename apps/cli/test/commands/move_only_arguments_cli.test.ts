import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';
import { expectParent } from '../lib/utils/expect_parent';
import { runCliInPty } from '../lib/utils/run_cli_in_pty';

// eslint-disable-next-line max-lines-per-function
describe('move only arguments through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  it('rejects an empty explicit only value before changing refs, checkout, index or public parents', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other', '-s', 'base', '--only=']);
    expect(result.status, result.stdout + result.stderr).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('--only');
    expect(fixture.snapshot()).to.deep.equal(before);
    expectParent(fixture, 'base', 'main');
    expectParent(fixture, 'child', 'base');
    expectParent(fixture, 'tip', 'child');
  });
  it('rejects contradictory only values before changing refs, checkout, index or public parents', () => {
    fixture.git(['switch', 'other']);
    const before = fixture.snapshot();
    const result = fixture.run([
      'move',
      'other',
      '-s',
      'base',
      '--only=true',
      '--only=false',
    ]);
    expect(result.status, result.stdout + result.stderr).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('--only');
    expect(fixture.snapshot()).to.deep.equal(before);
    expectParent(fixture, 'base', 'main');
    expectParent(fixture, 'child', 'base');
    expectParent(fixture, 'tip', 'child');
  });

  for (const options of [
    ['--only=nope'],
    ['--only', ''],
    ['--only=false', '--only=true'],
    ['--only', '--no-only'],
    ['--no-only', '--only'],
    ['--only', 'true', '--only', 'false'],
  ]) {
    it(`rejects invalid only declarations ${JSON.stringify(
      options
    )} before mutation`, () => {
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      const result = fixture.run(['move', 'other', '-s', 'base', ...options]);
      expect(result.status, result.stdout + result.stderr).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('--only');
      expect(result.stdout + result.stderr).not.to.include('Choose a new base');
      expect(fixture.snapshot()).to.deep.equal(before);
      expectParent(fixture, 'base', 'main');
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });
  }

  it('rejects malformed scope before checkout hooks or changes to staged, unstaged and untracked work', () => {
    fixture.git(['switch', 'other']);
    fixture.stage('main.txt', 'staged private work');
    fixture.write('main.txt', 'unstaged private work');
    fixture.write('private.txt', 'untracked private work');
    const trace = path.join(fixture.root, 'checkout-trace');
    fs.writeFileSync(
      path.join(fixture.repo, '.git/hooks/post-checkout'),
      `#!/bin/sh\ngit branch --show-current >> '${trace}'\n`,
      { mode: 0o755 }
    );
    const before = fixture.snapshot();
    const result = fixture.run(['move', 'other', '-s', 'base', '--only=nope']);
    expect(result.status, result.stdout + result.stderr).not.to.equal(0);
    expect(result.stdout + result.stderr).to.include('--only');
    expect(fixture.snapshot()).to.deep.equal(before);
    expect(fs.existsSync(trace)).to.equal(false);
  });

  for (const options of [
    ['--only='],
    ['--only=nope'],
    ['--only=true', '--only=false'],
  ]) {
    it(`rejects interactive only declarations ${JSON.stringify(
      options
    )} before selection or checkout`, () => {
      fixture.git(['switch', 'other']);
      const trace = path.join(fixture.root, 'checkout-trace');
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/post-checkout'),
        `#!/bin/sh\ngit branch --show-current >> '${trace}'\n`,
        { mode: 0o755 }
      );
      const before = fixture.snapshot();
      const result = runCliInPty(
        getTestCliCommand(['move', '-s', 'base', ...options]),
        {
          cwd: fixture.repo,
          env: fixture.env,
          responses: [{ prompt: 'Choose a new base', input: '\u0003' }],
        }
      );
      expect(result.status, result.output).not.to.equal(0);
      expect(result.status, result.output).not.to.equal(124);
      expect(result.output).to.include('--only');
      expect(result.output).not.to.include('Choose a new base');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fs.existsSync(trace)).to.equal(false);
      expectParent(fixture, 'base', 'main');
      expectParent(fixture, 'child', 'base');
      expectParent(fixture, 'tip', 'child');
    });
  }

  for (const { options, only } of [
    { options: ['other'], only: false },
    { options: ['--only', 'other'], only: true },
    { options: ['other', '--only', 'true'], only: true },
    { options: ['other', '--only', 'false'], only: false },
    { options: ['other', '--only=true', '--only'], only: true },
    {
      options: ['other', '--only=false', '--only', 'false', '--no-only'],
      only: false,
    },
  ]) {
    it(`preserves the declared scope for ${JSON.stringify(options)}`, () => {
      fixture.git(['switch', 'main']);
      const main = fixture.git(['rev-parse', 'main']);
      const other = fixture.git(['rev-parse', 'other']);
      fixture.ok(['move', ...options, '-s', 'base']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fixture.git(['log', '--format=%s', 'other..base'])).to.equal(
        'base'
      );
      const childParent = only ? 'main' : 'base';
      expect(
        fixture.git(['log', '--format=%s', `${childParent}..child`])
      ).to.equal('child');
      expect(fixture.git(['log', '--format=%s', 'child..tip'])).to.equal('tip');
      expect(fixture.git(['ls-tree', '--name-only', 'child'])).to.equal(
        only
          ? 'child.txt\nmain.txt'
          : 'base.txt\nchild.txt\nmain.txt\nother.txt'
      );
      expectParent(fixture, 'base', 'other');
      expectParent(fixture, 'child', childParent);
      expectParent(fixture, 'tip', 'child');
    });
  }
});
