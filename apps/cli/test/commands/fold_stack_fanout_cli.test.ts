import { expect } from 'chai';
import { spawnSync } from 'child_process';
import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';
import fs from 'fs';
import path from 'path';
import { CreateCliFixture } from '../lib/fixtures/create_cli';

// eslint-disable-next-line max-lines-per-function
describe('stack fold fan-out through the public CLI', function () {
  this.timeout(60000);
  let fixture: CreateCliFixture;
  beforeEach(() => {
    fixture = new CreateCliFixture();
  });
  afterEach(() => fixture?.cleanup());
  for (const keep of [false, true]) {
    it(`preserves roots at different selected levels and deep own ranges (keep=${keep})`, () => {
      fixture.branch('sibling', 'base');
      fixture.commit('sibling-second');
      fixture.branch('deep', 'sibling');
      fixture.commit('deep-second');
      fixture.branch('cousin', 'child');
      fixture.commit('cousin-second');
      const tip = fixture.git(['rev-parse', 'tip']);
      const tree = fixture.git(['rev-parse', 'tip^{tree}']);
      const history = fixture.git(['rev-list', 'tip']);
      const other = fixture.git(['rev-parse', 'other']);
      fixture.git(['switch', 'tip']);
      fixture.ok(['fold', '--stack', `--keep=${keep}`]);
      const survivor = keep ? 'tip' : 'base';
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['rev-parse', `${survivor}^{tree}`])).to.equal(tree);
      expect(fixture.git(['rev-list', survivor])).to.equal(history);
      expect(fixture.git(['rev-parse', 'other'])).to.equal(other);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..sibling`])
      ).to.equal('sibling\nsibling-second');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'sibling..deep'])
      ).to.equal('deep\ndeep-second');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..cousin`])
      ).to.equal('cousin\ncousin-second');
      expect(fixture.git(['branch', '--format=%(refname:short)'])).to.equal(
        [survivor, 'cousin', 'deep', 'main', 'other', 'sibling']
          .sort()
          .join('\n')
      );
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      for (const [name, parent] of [
        ['sibling', survivor],
        ['cousin', survivor],
        ['deep', 'sibling'],
        [survivor, 'main'],
      ]) {
        fixture.ok(['checkout', name]);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      }
    });

    it(`continues a real conflict after the complete selected collapse (keep=${keep})`, () => {
      fixture.branch('conflict', 'base');
      fixture.stage('child.txt', 'sibling conflict');
      fixture.git(['commit', '-m', 'conflicting own edit']);
      fixture.branch('deep', 'conflict');
      fixture.branch('cousin', 'base');
      // The departure child disappears in both survivor modes.
      fixture.git(['switch', 'child']);
      const selectedTip = fixture.git(['rev-parse', 'tip']);
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        'Selected collapse is complete'
      );
      expect(result.stdout + result.stderr).to.include(
        'Current checkout: detached HEAD.'
      );
      expect(result.stdout + result.stderr).to.include(
        "ch restack --branch 'conflict' --only"
      );
      expect(result.stdout + result.stderr).to.include(
        "ch restack --branch 'deep' --only"
      );
      expect(result.stdout + result.stderr).to.include(
        "ch restack --branch 'cousin' --only"
      );
      expect(result.stdout + result.stderr).to.include(
        `ch checkout '${keep ? 'tip' : 'base'}'`
      );
      expect(fixture.git(['ls-files', '--unmerged'])).not.to.equal('');
      const rebaseDir = path.resolve(
        fixture.repo,
        fixture.git(['rev-parse', '--git-path', 'rebase-merge'])
      );
      expect(fs.existsSync(rebaseDir)).to.equal(true);
      const survivor = keep ? 'tip' : 'base';
      expect(fixture.git(['rev-parse', survivor])).to.equal(selectedTip);
      expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
      fixture.ok(['info']);
      fixture.ok(['log', 'short']);
      fixture.stage('child.txt', 'resolved selected plus sibling content');
      fixture.ok(['continue']);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      expect(fs.existsSync(rebaseDir)).to.equal(false);
      expect(fixture.git(['rev-parse', survivor])).to.equal(selectedTip);
      expect(
        fixture.git([
          'log',
          '--reverse',
          '--format=%s',
          `${survivor}..conflict`,
        ])
      ).to.equal('conflict\nconflicting own edit');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'conflict..deep'])
      ).to.equal('deep');
      expect(fixture.git(['show', 'deep:child.txt'])).to.equal(
        'resolved selected plus sibling content'
      );
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..cousin`])
      ).to.equal('cousin');
      for (const [name, parent] of [
        ['conflict', survivor],
        ['deep', 'conflict'],
        ['cousin', survivor],
      ]) {
        fixture.ok(['checkout', name]);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      }
    });

    it(`reports surviving roots and frozen own ranges after root metadata publication fails (keep=${keep})`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('deep', 'sibling');
      fixture.branch('cousin', 'child');
      fixture.git(['switch', 'tip']);
      const survivor = keep ? 'tip' : 'base';
      const tip = fixture.git(['rev-parse', 'tip']);
      const from = fixture.git(['rev-parse', 'base']);
      fs.writeFileSync(
        path.join(fixture.repo, '.git/hooks/reference-transaction'),
        '#!/bin/sh\nif [ "$1" = prepared ]; then\nwhile read old new ref; do\ncase "$ref" in refs/branch-metadata/cousin) echo "root metadata refused" >&2; exit 1;; esac\ndone\nfi\n',
        { mode: 0o755 }
      );
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      expect(result.status).not.to.equal(0);
      expect(result.stdout + result.stderr).to.include(
        `Selected refs were folded into ${survivor}`
      );
      expect(result.stdout + result.stderr).to.include('root metadata refused');
      expect(result.stdout + result.stderr).to.include(
        `git rebase --onto '${survivor}' '${from}' 'sibling'`
      );
      expect(result.stdout + result.stderr).to.include(
        "ch track 'deep' --parent 'sibling'"
      );
      expect(result.stdout + result.stderr).to.include(
        `ch track 'cousin' --parent '${survivor}'`
      );
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
      fs.unlinkSync(
        path.join(fixture.repo, '.git/hooks/reference-transaction')
      );
      const command = getTestCliCommand([])
        .map((argument) => `'${argument.replace(/'/g, "'\\''")}'`)
        .join(' ');
      fs.writeFileSync(
        path.join(fixture.root, 'bin/ch'),
        `#!/bin/sh\nexec ${command} "$@" --no-interactive\n`,
        { mode: 0o755 }
      );
      const recovery = (result.stdout + result.stderr)
        .split('\n')
        .filter((line) => /^(ch track |git rebase |ch checkout )/.test(line))
        .join('\n');
      const retry = spawnSync('/bin/sh', ['-ec', recovery], {
        cwd: fixture.repo,
        env: fixture.env,
        encoding: 'utf8',
        timeout: 30000,
      });
      if (retry.error) throw retry.error;
      expect(retry.status, retry.stdout + retry.stderr).to.equal(0);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..sibling`])
      ).to.equal('sibling');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'sibling..deep'])
      ).to.equal('deep');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..cousin`])
      ).to.equal('cousin');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
      for (const [name, parent] of [
        ['sibling', survivor],
        ['deep', 'sibling'],
        ['cousin', survivor],
      ]) {
        fixture.ok(['checkout', name]);
        fixture.ok(['down']);
        expect(fixture.git(['branch', '--show-current'])).to.equal(parent);
      }
    });
    it(`uses public named recovery when only the post-collapse attachment fails (keep=${keep})`, () => {
      fixture.branch('sibling', 'base');
      fixture.branch('deep', 'sibling');
      fixture.git(['switch', 'child']);
      const survivor = keep ? 'tip' : 'base';
      const tip = fixture.git(['rev-parse', 'tip']);
      const hook = path.join(fixture.repo, '.git/hooks/post-checkout');
      fs.writeFileSync(
        hook,
        `#!/bin/sh\nif [ "$(git symbolic-ref --short -q HEAD)" = ${survivor} ]; then echo attachment-refused >&2; exit 1; fi\n`,
        { mode: 0o755 }
      );
      const result = fixture.run(['fold', '--stack', `--keep=${keep}`]);
      const output = result.stdout + result.stderr;
      expect(result.status).not.to.equal(0);
      expect(output).to.include(`Selected refs were folded into ${survivor}`);
      expect(output).to.include(`Current checkout: ${survivor}`);
      expect(output).to.include("ch restack --branch 'sibling' --only");
      expect(output).to.include("ch restack --branch 'deep' --only");
      expect(output).not.to.include('git rebase --onto');
      expect(fixture.git(['branch', '--list', 'child'])).to.equal('');
      expect(fixture.git(['rev-parse', survivor])).to.equal(tip);
      fs.unlinkSync(hook);
      fixture.ok(['restack', '--branch', 'sibling', '--only']);
      fixture.ok(['restack', '--branch', 'deep', '--only']);
      fixture.ok(['checkout', survivor]);
      expect(fixture.git(['branch', '--show-current'])).to.equal(survivor);
      expect(
        fixture.git(['log', '--reverse', '--format=%s', `${survivor}..sibling`])
      ).to.equal('sibling');
      expect(
        fixture.git(['log', '--reverse', '--format=%s', 'sibling..deep'])
      ).to.equal('deep');
      expect(fixture.git(['status', '--porcelain'])).to.equal('');
    });
  }
});
