import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack fold original arguments through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  const privateName = "private '*[é]\n.bin";
  const bytes = Buffer.from([0, 255, 128, 10, 13, 42]);
  beforeEach(() => {
    fixture = new CreateCliFixture();
    fs.appendFileSync(
      path.join(fixture.repo, '.git/info/exclude'),
      '\n*.bin\n'
    );
    fs.writeFileSync(path.join(fixture.repo, privateName), bytes);
    fixture.git(['switch', 'child']);
  });
  afterEach(() => fixture?.cleanup());

  for (const args of [
    ['--stack', '--keep=false', '-qk'],
    ['--stack', '-qk', '--keep=false'],
    ['--stack', '--keep=true', '-qk=false'],
    ['--stack', '-qk=false', '--keep=true'],
    ['--stack', '--keep=false', '-kq'],
    ['--stack', '-kq', '--keep=false'],
    ['--stack', '--keep=false', '-qkq'],
    ['--stack', '-qkq', '--keep=false'],
    ['--stack', '-kk=false'],
    ['--stack', '-qkk', 'false'],
    ['--stack', '-qk=garbage'],
    ['--stack', '-qk=bad\nvalue'],
    ['--stack', '--keep=bad\nvalue'],
    ['--stack=bad\nvalue'],
    ['--stack', '-qk='],
    ['--stack', '-qk', ''],
    ['--stack', '-qk1'],
    ['--stack', '-kqk=garbage'],
    ['--stack', '-qk=true', '-qk=false'],
    ['--stack', '-qk=false', '-qk=true'],
    ['--keep=false', '-qk', '--stack'],
    ['-qk=garbage', '--stack'],
    ['--stack', '--', 'tip'],
    ['--stack', '--', '--force'],
    ['--stack', '--', '--keep'],
    ['--stack', '--', ''],
  ]) {
    it(`refuses invalid original input before effects: ${JSON.stringify(
      args
    )}`, () => {
      const trace = path.join(fixture.root, 'mutation-trace');
      for (const hook of ['post-checkout', 'reference-transaction']) {
        fs.writeFileSync(
          path.join(fixture.repo, '.git/hooks', hook),
          `#!/bin/sh\nprintf 'mutation\\n' >> '${trace}'\n`,
          { mode: 0o755 }
        );
      }
      const before = fixture.snapshot();
      const index = fs.readFileSync(path.join(fixture.repo, '.git/index'));
      const result = run(args);
      expect(result.status, result.stdout + result.stderr).not.to.equal(0);
      expect(fixture.snapshot()).to.deep.equal(before);
      expect(
        fs.readFileSync(path.join(fixture.repo, '.git/index'))
      ).to.deep.equal(index);
      expect(
        fs.readFileSync(path.join(fixture.repo, privateName))
      ).to.deep.equal(bytes);
      expect(fs.existsSync(trace)).to.equal(false);
      for (const [name, parent] of [
        ['base', 'main'],
        ['child', 'base'],
        ['tip', 'child'],
      ]) {
        fixture.ok(['checkout', name]);
        expect(fixture.ok(['info'])).to.include(`Parent: ${parent}`);
      }
    });
  }

  for (const [args, survivor] of [
    [['--stack', '-qk'], 'tip'],
    [['--stack', '-kq'], 'tip'],
    [['--stack', '-qkq'], 'tip'],
    [['--stack', '-qkk'], 'tip'],
    [['--stack', '-qk=true'], 'tip'],
    [['--stack', '-qk', 'true'], 'tip'],
    [['--stack', '-qk=false'], 'base'],
    [['--stack', '-qk', 'false'], 'base'],
    [['--stack', '-kq=false'], 'tip'],
    [['--stack', '-qkq', 'false'], 'tip'],
    [['--stack', '--keep', '-qkk=true'], 'tip'],
    [['--stack', '--keep=false', '-qk=false'], 'base'],
    [['--stack', '-qk=false', '--no-keep'], 'base'],
    [['--stack', '-qk=false', '-qk=false'], 'base'],
    [['--stack', '--no-interactive', '--'], 'base'],
  ] as const) {
    it(`preserves the full chain and intended ${survivor} survivor: ${JSON.stringify(
      args
    )}`, () => {
      const tip = fixture.git(['rev-parse', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const history = fixture.git(['rev-list', 'tip']);
      const main = fixture.git(['rev-parse', 'main']);
      const other = fixture.git(['rev-parse', 'other']);
      const result = run(args);
      expect(result.status, result.stdout + result.stderr).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['rev-parse', `${survivor}^{tree}`])).to.equal(tree);
      expect(fixture.git(['rev-list', survivor])).to.equal(history);
      expect(fixture.git(['rev-parse', 'main'])).to.equal(main);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
        [survivor, 'main', 'other'].sort().join('\n')
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(
        fs.readFileSync(path.join(fixture.repo, privateName))
      ).to.deep.equal(bytes);
      expect(fixture.ok(['info'])).to.include('Parent: main');
    });
  }

  for (const explicitFalse of [false, true]) {
    for (const [keepArgs, keep] of [
      [['--keep=false', '-qk'], true],
      [['--keep=true', '-qk=false'], false],
      [['-qk=garbage'], false],
      [['-kk=false'], false],
      [['--', 'tip', '--keep'], false],
    ] as const) {
      it(`retains ordinary fold parsing (stack=false=${explicitFalse}): ${JSON.stringify(
        keepArgs
      )}`, () => {
        const child = fixture.git(['rev-parse', 'child']);
        const tip = fixture.git(['rev-parse', 'tip']);
        const result = run([
          ...(explicitFalse ? ['--stack=false'] : []),
          ...keepArgs,
        ]);
        expect(result.status, result.stdout + result.stderr).to.equal(0);
        const survivor = keep ? 'child' : 'base';
        expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
        expect(fixture.git(['rev-parse', survivor])).to.equal(child);
        expect(fixture.git(['rev-parse', 'tip'])).to.equal(tip);
        expect(fixture.ok(['info'])).to.include('Parent: main');
        fixture.ok(['checkout', 'tip']);
        expect(fixture.ok(['info'])).to.include(`Parent: ${survivor}`);
      });
    }
  }

  function run(args: readonly string[]) {
    const [executable, ...cliArgs] = getTestCliCommand([
      'fold',
      '--no-interactive',
      ...args,
    ]);
    const result = spawnSync(executable, cliArgs, {
      cwd: fixture.repo,
      env: fixture.env,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.error) throw result.error;
    return result;
  }
});
