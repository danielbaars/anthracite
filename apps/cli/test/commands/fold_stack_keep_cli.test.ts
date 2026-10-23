import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('keeping the chosen stack tip through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());

  for (const departure of ['base', 'child', 'tip']) {
    for (const keep of ['--keep', '-k', '--keep=true']) {
      it(`keeps the original tip from ${departure} using ${keep}`, () => {
        const tip = fixture.git(['rev-parse', 'tip']);
        const tree = fixture.git(['rev-parse', 'tip^{tree}']);
        const history = fixture.git(['rev-list', 'tip']);
        const main = fixture.git(['rev-parse', 'main']);
        const other = fixture.git(['rev-parse', 'other']);
        fixture.git(['switch', departure]);
        fixture.ok(['fold', '--stack', keep]);
        expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
        expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
        expect(fixture.git(['rev-parse', 'tip^{tree}'])).to.equal(tree);
        expect(fixture.git(['rev-list', 'tip'])).to.equal(history);
        expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
          'main\nother\ntip'
        );
        expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
        expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
        expect(fixture.git(['status', '--porcelain'])).to.equal('');
        expect(fixture.ok(['info'])).to.include('Parent: main');
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal('main');
      });
    }
  }

  it('retains every own commit and ancestry, even with colliding tags', () => {
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
    const tree = fixture.git(['rev-parse', 'refs/heads/tip^{tree}']);
    const history = fixture.git(['rev-list', 'refs/heads/tip']);
    fixture.git(['switch', 'base']);
    fixture.ok(['fold', '--stack', '-k']);
    expect(fixture.git(['branch', '--show-current'])).to.equal('tip');
    expect(fixture.git(['rev-parse', 'refs/heads/tip'])).to.equal(tip);
    expect(fixture.git(['rev-parse', 'refs/heads/tip^{tree}'])).to.equal(tree);
    expect(fixture.git(['rev-list', 'refs/heads/tip'])).to.equal(history);
    expect(
      fixture.git(['log', '--reverse', '--format=%s', 'main..refs/heads/tip'])
    ).to.equal('base\nbase-second\nchild\nchild-second\ntip\ntip-second');
    expect(fixture.git(['rev-parse', 'refs/tags/base'])).to.equal(
      fixture.git(['rev-parse', 'main'])
    );
    expect(fixture.ok(['info'])).to.include('Parent: main');
  });

  for (const workAt of ['none', 'empty-base', 'empty-middle', 'empty-tip']) {
    it(`keeps an empty chosen tip with own work at ${workAt}`, () => {
      fixture.git(['switch', 'main']);
      for (const name of ['empty-base', 'empty-middle', 'empty-tip']) {
        fixture.ok(['create', name]);
        if (workAt === name) fixture.commit('own-work');
      }
      const tip = fixture.git(['rev-parse', 'empty-tip']);
      const tree = fixture.git(['rev-parse', 'empty-tip^{tree}']);
      const history = fixture.git(['rev-list', 'empty-tip']);
      fixture.git(['switch', 'empty-middle']);
      fixture.ok(['fold', '--stack', '--keep']);
      expect(fixture.git(['branch', '--show-current'])).to.equal('empty-tip');
      expect(fixture.git(['rev-parse', 'empty-tip'])).to.equal(tip);
      expect(fixture.git(['rev-parse', 'empty-tip^{tree}'])).to.equal(tree);
      expect(fixture.git(['rev-list', 'empty-tip'])).to.equal(history);
      expect(fixture.git(['branch', '--list', 'empty-*'])).to.equal(
        '* empty-tip'
      );
      expect(fixture.ok(['info'])).to.include('Parent: main');
    });
  }

  for (const keep of ['--keep', '-k']) {
    it(`keeps a standalone feature as a clean no-op using ${keep}`, () => {
      fixture.git(['switch', 'other']);
      const before = fixture.snapshot();
      fixture.ok(['fold', '--stack', keep]);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['info'])).to.include('Parent: main');
    });
  }

  for (const args of [
    ['--keep', '-k', '--keep=true'],
    ['-k=true', '--keep=true'],
    ['--keep=false', '-k=false'],
    ['--no-keep', '--keep=false'],
  ]) {
    it(`accepts identical alias declarations ${JSON.stringify(args)}`, () => {
      const tip = fixture.git(['rev-parse', 'tip']);
      fixture.ok(['fold', '--stack', ...args]);
      const survivor =
        args[0].includes('false') || args[0] === '--no-keep' ? 'base' : 'tip';
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.ok(['info'])).to.include('Parent: main');
    });
  }

  for (const args of [
    ['--keep=false', '-k'],
    ['-k', '--no-keep'],
    ['-k=false', '--keep'],
    ['-k='],
    ['-k=garbage'],
    ['--keep=true', '--keep='],
    ['--keep', ''],
  ]) {
    it(`refuses malformed or conflicting keep aliases ${JSON.stringify(
      args
    )} before effects`, () => {
      const before = fixture.snapshot();
      const result = fixture.run(['fold', '--stack', ...args]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include('--keep requires');
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(fixture.ok(['info'])).to.include('Parent: main');
    });
  }

  it('executes the safely quoted surviving-name recovery after its deleted departure is gone', () => {
    const survivor = "tip'quote";
    fixture.git(['switch', 'tip']);
    fixture.git(['branch', '-m', survivor]);
    fixture.ok(['track', survivor, '--parent', 'child']);
    const tip = fixture.git(['rev-parse', survivor]);
    fixture.git(['switch', 'child']);
    const hook = path.join(fixture.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\nif git symbolic-ref -q HEAD >/dev/null; then echo "return refused" >&2; exit 1; fi\n',
      { mode: 0o755 }
    );
    const result = fixture.run(['fold', '--stack', '--keep']);
    const output = result.stdout + result.stderr;
    expect(result.status).not.to.equal(0);
    const recovery = "ch checkout 'tip'\\''quote'";
    expect(output).to.include(recovery);
    expect(output).not.to.include("ch checkout 'child'");
    expect(output).not.to.include("ch track 'child'");
    expect(fixture.git(['branch', '--list', 'base', 'child'])).to.equal('');
    expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
    fs.unlinkSync(hook);
    const command = getTestCliCommand([])
      .map((argument) => `'${argument.replace(/'/g, "'\\''")}'`)
      .join(' ');
    fs.writeFileSync(
      path.join(fixture.root, 'bin', 'ch'),
      `#!/bin/sh\nexec ${command} "$@" --no-interactive\n`,
      { mode: 0o755 }
    );
    const retry = spawnSync('/bin/sh', ['-c', recovery], {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (retry.error) throw retry.error;
    expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
    expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
    expect(fixture.ok(['info'])).to.include('Parent: main');
    expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
  });
});
